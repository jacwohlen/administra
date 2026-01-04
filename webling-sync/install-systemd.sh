#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"

echo "Installing webling-sync systemd services..."

# Create systemd user directory if it doesn't exist
mkdir -p "$SYSTEMD_USER_DIR"

# Copy service and timer files
echo "Copying service and timer files to $SYSTEMD_USER_DIR..."
cp "$SCRIPT_DIR/systemd/webling-sync-events.service" "$SYSTEMD_USER_DIR/"
cp "$SCRIPT_DIR/systemd/webling-sync-events.timer" "$SYSTEMD_USER_DIR/"
cp "$SCRIPT_DIR/systemd/webling-sync-members.service" "$SYSTEMD_USER_DIR/"
cp "$SCRIPT_DIR/systemd/webling-sync-members.timer" "$SYSTEMD_USER_DIR/"

echo ""
echo "Files copied successfully!"
echo ""
echo "The services are configured for production (ENV=prod) by default."
echo ""
echo "To use staging environment instead:"
echo "  Edit the service files and change: Environment=\"ENV=prod\" to Environment=\"ENV=staging\""
echo "  - $SYSTEMD_USER_DIR/webling-sync-events.service"
echo "  - $SYSTEMD_USER_DIR/webling-sync-members.service"
echo ""
echo "Next steps:"
echo "1. Reload systemd and enable timers:"
echo "   systemctl --user daemon-reload"
echo "   systemctl --user enable --now webling-sync-events.timer"
echo "   systemctl --user enable --now webling-sync-members.timer"
echo ""
echo "2. Enable lingering (allows services to run when not logged in):"
echo "   loginctl enable-linger \$USER"
echo ""
echo "3. Verify timers are active:"
echo "   systemctl --user list-timers"
echo ""
