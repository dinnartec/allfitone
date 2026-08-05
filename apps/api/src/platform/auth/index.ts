/**
 * Authentication middleware. Verifies the JWT against the surface's JWKS, validates client_id, and resolves the subject to a person in the database. Only 'sub' and 'sid' are used: org_id, role and permissions are deliberately ignored.
 */
export {}
