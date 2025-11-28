import { z } from "zod";

const positiveIntegerParam = z.coerce
  .number()
  .int({ message: "Must be an integer" })
  .gt(0, { message: "Must be greater than 0" });

const nonNegativeIntegerParam = z.coerce
  .number()
  .int({ message: "Must be an integer" })
  .min(0, { message: "Must be non-negative" });

const paginationParamsSchema = z.object({
  limit: positiveIntegerParam.optional().nullish(),
  offset: nonNegativeIntegerParam.optional().nullish(),
});

function normalizeQueryValue(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") {
    return undefined;
  }
  return trimmed;
}

type PaginatableQuery = {
  limit: (value: number) => unknown;
  offset: (value: number) => unknown;
};

type PaginationParams = z.infer<typeof paginationParamsSchema>;

function applyPagination(query: PaginatableQuery, pagination: PaginationParams) {
  if (pagination.limit) {
    query.limit(pagination.limit);
  }

  if (pagination.offset) {
    query.offset(pagination.offset);
  }
}

export {
  applyPagination,
  normalizeQueryValue,
  nonNegativeIntegerParam,
  paginationParamsSchema,
  positiveIntegerParam,
  type PaginationParams,
};
