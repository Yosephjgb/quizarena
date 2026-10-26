// Express middleware: validate req.body with a zod schema.
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issue = result.error.issues[0];
      const field = issue.path.join('.') || 'body';
      return res.status(400).json({ error: `${field}: ${issue.message}` });
    }
    req.body = result.data;
    next();
  };
}
