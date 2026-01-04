#!/usr/bin/env bash
set -e

# Determine which environment to use (defaults to prod)
ENV=${ENV:-prod}

# Source the appropriate environment file
ENV_FILE="$(dirname "$0")/.env.${ENV}"

if [ ! -f "$ENV_FILE" ]; then
    echo "Error: Environment file $ENV_FILE not found"
    echo "Please create .env.${ENV} or set ENV variable (prod or staging)"
    exit 1
fi

source "$ENV_FILE"

# Run the Python script
exec "$(dirname "$0")/.env/bin/python" "$(dirname "$0")/src/webling.py"
