# Database tests

Place pgTAP files in this directory using the documented test IDs, for example
`T-PRIV-RLS-01.test.sql`. Every test must run inside a transaction and roll it
back so the local database remains reproducible.
