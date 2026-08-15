#!/bin/sh

echo "Installing dependencies..."
pnpm install

echo "Applying database migrations..."
pnpm prisma migrate deploy

echo "Starting development server..."
pnpm dev
