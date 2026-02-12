#!/bin/bash

# IL-Order Installation Script for Ubuntu 24
# https://github.com/ruolez/il-order

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="/opt/il-order"
REPO_URL="https://github.com/ruolez/il-order.git"
COMPOSE_FILE="docker-compose.yml"

# Print banner
print_banner() {
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════╗"
    echo "║         IL-Order Installation             ║"
    echo "║    Inventory Ordering System              ║"
    echo "╚═══════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Print colored message
print_msg() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# Check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        print_error "This script must be run as root (sudo)"
        exit 1
    fi
}

# Detect local IP address
detect_ip() {
    # Try to get the primary network interface IP
    local ip=$(hostname -I | awk '{print $1}')
    if [[ -z "$ip" ]]; then
        ip="localhost"
    fi
    echo "$ip"
}

# Check and install Docker
install_docker() {
    if command -v docker &> /dev/null; then
        print_msg "Docker is already installed"
        return 0
    fi

    print_msg "Installing Docker..."

    # Remove old versions
    apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

    # Install prerequisites
    apt-get update
    apt-get install -y ca-certificates curl gnupg lsb-release

    # Add Docker's official GPG key
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    # Set up the repository
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      tee /etc/apt/sources.list.d/docker.list > /dev/null

    # Install Docker Engine
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Start and enable Docker
    systemctl start docker
    systemctl enable docker

    print_msg "Docker installed successfully"
}

# Configure CORS origin in docker-compose
configure_cors() {
    local ip=$1
    local compose_file="$INSTALL_DIR/$COMPOSE_FILE"

    # Update CORS_ORIGIN in docker-compose.yml
    if grep -q "CORS_ORIGIN=" "$compose_file"; then
        sed -i "s|CORS_ORIGIN=.*|CORS_ORIGIN=http://$ip|g" "$compose_file"
    fi

    print_msg "CORS configured for IP: $ip"
}

# Fresh installation
do_install() {
    echo ""
    print_msg "Starting fresh installation..."

    # Get IP address
    local detected_ip=$(detect_ip)
    echo ""
    echo -e "Detected IP address: ${YELLOW}$detected_ip${NC}"
    read -p "Enter server IP address [$detected_ip]: " user_ip
    local ip=${user_ip:-$detected_ip}

    # Install Docker if needed
    install_docker

    # Clone repository
    if [[ -d "$INSTALL_DIR" ]]; then
        print_warn "Installation directory already exists: $INSTALL_DIR"
        read -p "Remove existing installation? (y/N): " confirm
        if [[ "$confirm" =~ ^[Yy]$ ]]; then
            # Stop containers if running
            if [[ -f "$INSTALL_DIR/$COMPOSE_FILE" ]]; then
                cd "$INSTALL_DIR"
                docker compose down 2>/dev/null || true
            fi
            rm -rf "$INSTALL_DIR"
        else
            print_error "Installation cancelled"
            exit 1
        fi
    fi

    print_msg "Cloning repository..."
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"

    # Configure CORS
    configure_cors "$ip"

    # Build and start containers
    print_msg "Building and starting containers..."
    docker compose up -d --build

    # Wait for services to be ready
    echo ""
    print_msg "Waiting for services to start..."
    sleep 5

    # Check health
    if curl -s http://localhost:5001/health | grep -q "healthy"; then
        print_msg "Backend is healthy"
    else
        print_warn "Backend health check pending..."
    fi

    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║       Installation Complete!              ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "Access IL-Order at: ${BLUE}http://$ip${NC}"
    echo -e "API endpoint: ${BLUE}http://$ip:5001${NC}"
    echo ""
    echo -e "Next steps:"
    echo -e "  1. Open ${BLUE}http://$ip${NC} in your browser"
    echo -e "  2. Go to Settings and configure your MS SQL Server connection"
    echo ""
}

# Update installation
do_update() {
    echo ""

    if [[ ! -d "$INSTALL_DIR" ]]; then
        print_error "IL-Order is not installed at $INSTALL_DIR"
        print_warn "Please run a fresh installation first"
        exit 1
    fi

    cd "$INSTALL_DIR"

    print_msg "Stopping containers..."
    docker compose down

    print_msg "Pulling latest changes..."
    git fetch origin
    git reset --hard origin/main

    print_msg "Rebuilding containers..."
    docker compose up -d --build

    print_msg "Cleaning up unused Docker images..."
    docker image prune -f

    # Wait for services
    print_msg "Waiting for services to start..."
    sleep 5

    # Run database migrations
    print_msg "Running database migrations..."
    docker exec il-order-db psql -U ilorder -d ilorder -c "
        ALTER TABLE product_overrides ADD COLUMN IF NOT EXISTS manual_order_period_days INT;
        ALTER TABLE sql_config ADD COLUMN IF NOT EXISTS admin_database VARCHAR(100);
    " 2>/dev/null || true

    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║         Update Complete!                  ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${YELLOW}Note:${NC} Your data and settings have been preserved."
    echo ""
}

# Remove installation
do_remove() {
    echo ""

    if [[ ! -d "$INSTALL_DIR" ]]; then
        print_error "IL-Order is not installed at $INSTALL_DIR"
        exit 1
    fi

    cd "$INSTALL_DIR"

    echo -e "${YELLOW}WARNING:${NC} This will stop and remove IL-Order containers."
    echo ""
    read -p "Remove data volumes (settings, orders, etc.)? (y/N): " remove_data

    print_msg "Stopping and removing containers..."

    if [[ "$remove_data" =~ ^[Yy]$ ]]; then
        docker compose down -v
        print_msg "Containers and data volumes removed"
    else
        docker compose down
        print_msg "Containers removed (data preserved)"
    fi

    read -p "Remove installation directory ($INSTALL_DIR)? (y/N): " remove_dir
    if [[ "$remove_dir" =~ ^[Yy]$ ]]; then
        cd /
        rm -rf "$INSTALL_DIR"
        print_msg "Installation directory removed"
    fi

    print_msg "Cleaning up unused Docker images..."
    docker image prune -f

    echo ""
    echo -e "${GREEN}IL-Order has been removed.${NC}"

    if [[ ! "$remove_data" =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Note:${NC} Data volume 'il-order_postgres_data' was preserved."
        echo "To remove it manually: docker volume rm il-order_postgres_data"
    fi
    echo ""
}

# Show menu
show_menu() {
    echo ""
    echo "Please select an option:"
    echo ""
    echo "  1) Install    - Fresh installation"
    echo "  2) Update     - Update from GitHub (preserves data)"
    echo "  3) Remove     - Remove IL-Order"
    echo "  4) Exit"
    echo ""
}

# Main
main() {
    print_banner
    check_root

    while true; do
        show_menu
        read -p "Enter choice [1-4]: " choice

        case $choice in
            1)
                do_install
                break
                ;;
            2)
                do_update
                break
                ;;
            3)
                do_remove
                break
                ;;
            4)
                echo ""
                print_msg "Goodbye!"
                exit 0
                ;;
            *)
                print_error "Invalid option. Please enter 1-4."
                ;;
        esac
    done
}

main "$@"
