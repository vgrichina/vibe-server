# Vibe Server

A multi-tenant API proxy for LLM services with integrated authentication, caching, and realtime capabilities.

## Project Structure

Vibe Server uses a modular "stacks" architecture powered by [vibe-compiler](https://github.com/vgrichina/vibe-compiler) to compile specifications into runnable code:

- `stacks/` - Feature specifications and documentation
- `output/` - Generated implementation code
- `vibec.json` - Build configuration

## Core Features

### Web Server (001)
- Multi-tenant Koa-based web server
- Tenant-specific configuration in Redis

### Chat Completions (003)
- OpenAI-compatible chat API
- Multiple LLM provider support
- Token usage tracking

### Realtime WebSockets (004)
- Bidirectional streaming for voice/text
- Session management
- Tool integration

### Caching System (005)
- Tenant-configurable caching
- TTL-based response caching
- Fee adjustments for cached responses

### SSO Integration (006)
- OAuth with multiple providers (Google, Apple)
- JWT token management
- Stripe subscription integration

## Development

Each stack has corresponding tests in the `stacks/tests/` directory.

## Build System

The application uses `vibec` to assemble the final application from stack specifications.