# Development setup

## Requirements

- Node.js 22 LTS
- npm 10+
- Git
- SQLite-compatible runtime

## Local setup

```bash
npm install
cp .env.example .env
npm run db:migrate
npm test
npm start
```

## Environment variables

`PORT` sets the HTTP server port.
`SESSION_SECRET` should be a strong random value used for future session signing.
`DATABASE_PATH` sets the SQLite file path.

## Notes

The prototype uses a local SQLite file in `database/dev.db` by default when no environment override is provided.
