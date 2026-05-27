import { z } from 'zod';

const schema = z.object({
  foo: z.string(),
  bar: z.number().optional().default(0),
});

// z.object() returns ZodObject which extends ZodType
// So this is the inferred type:
const inferred = schema;

// Zod's ZodObject<T> type is a ZodType<T> where T is the input/output type
console.log('schema instanceof z.ZodType:', schema instanceof z.ZodSchema);
console.log('Schema type constructor:', schema.constructor.name);

// The type assertion on lines 28-38 is checking that the parsed type matches:
// It converts from z.infer (implicit) to explicit type definition
console.log('Type assertion is decorative — the schema object is already the correct ZodType');
