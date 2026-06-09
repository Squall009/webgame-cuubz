#!/bin/bash
# sync.sh - Sync workspace to remote server
# Usage: ./sync.sh
# Template for web-based workspaces (tar-over-SSH deployment)

set -e

# Configuration
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_NAME="$(basename "$SOURCE_DIR")"
REMOTE_USER="dadmin"
REMOTE_HOST="10.0.30.160"
REMOTE_DIR="/var/www/html"
SSH_KEY="$HOME/.ssh/id_ed25519"

# Verify SSH key exists
if [ ! -f "$SSH_KEY" ]; then
    echo "Error: SSH key not found at $SSH_KEY"
    exit 1
fi

echo "Starting sync to ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}..."

# Create a tar archive of the project (excluding node_modules and .git)
ARCHIVE="/tmp/${PROJECT_NAME}-sync.tar.gz"
cd "$SOURCE_DIR"
tar czf "$ARCHIVE" \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='dist' \
    .

# Upload and extract on remote, then fix permissions
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$ARCHIVE" "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/${PROJECT_NAME}.tar.gz"

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${REMOTE_USER}@${REMOTE_HOST}" \
    "cd ${REMOTE_DIR} && tar xzf ${PROJECT_NAME}.tar.gz && rm ${PROJECT_NAME}.tar.gz \
     && find ${REMOTE_DIR} -type f -exec chmod 644 {} + \
     && find ${REMOTE_DIR} -type d -exec chmod 755 {} +"

rm -f "$ARCHIVE"

echo "Sync complete!"
