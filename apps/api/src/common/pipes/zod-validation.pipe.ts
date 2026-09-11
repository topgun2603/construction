import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { ApiError } from '../errors/api-error';

/**
 * Validates and *parses* a payload with a zod schema from `@sitebook/shared`,
 * which is the single source of truth for request shapes (spec §9, §17). The
 * handler receives the schema's output type, so transforms — phone normalisation,
 * paise coercion to bigint — have already happened by the time domain code runs.
 */
@Injectable()
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown, _metadata: ArgumentMetadata): z.infer<T> {
    try {
      return this.schema.parse(value) as z.infer<T>;
    } catch (error) {
      if (error instanceof ZodError) {
        throw ApiError.validationFailed(
          error.issues.map((issue) => ({
            path: issue.path.join('.'),
            code: issue.code,
            message: issue.message,
          })),
        );
      }
      throw error;
    }
  }
}

/** `@Body(zodBody(createProjectSchema)) body: CreateProjectInput` */
export function zodBody<T extends ZodTypeAny>(schema: T): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}
