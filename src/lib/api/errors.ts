/**
 * Errores y códigos de estado para la API REST.
 */

export const API_ERRORS = {
  UNAUTHORIZED: "No autenticado",
  FORBIDDEN: "Sin acceso a esta empresa",
  BAD_REQUEST: "Solicitud inválida",
  NOT_FOUND: "Recurso no encontrado",
  VALIDATION: "Error de validación",
} as const;

export type ApiErrorCode = keyof typeof API_ERRORS;
