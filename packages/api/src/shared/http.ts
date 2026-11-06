/** Mutations carry an operation ID so a retried request never applies twice (docs: Network and API contract). */
export const OPERATION_HEADER = 'x-alcove-operation';


/* ---------- logging ---------- */
/** Every response carries this header; error bodies repeat it as `requestId`. Quote it when reporting a problem. */
export const REQUEST_ID_HEADER = 'x-request-id';
