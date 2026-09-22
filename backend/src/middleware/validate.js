import { ZodError } from 'zod';

/** Wrap a zod schema as middleware; 400 + readable message on failure. */
export function validate(schema) {
  return (req, _res, next) => {
    try {
      const parsed = schema.parse(req.body);
      req.body = parsed;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const first = err.errors[0];
        return next(Object.assign(new Error(first?.message || 'Invalid input'), { status: 400 }));
      }
      next(err);
    }
  };
}