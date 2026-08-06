# Database migrations

Create timestamped SQL migrations from the repository root:

```bash
bun run db:migration:new -- <migration_name>
```

Do not place migrations outside this directory and do not edit a migration after
it has been applied to a shared environment.
