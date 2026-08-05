/**
 * Public interface của `common` — hạ tầng dùng chung cho mọi module nghiệp vụ.
 *
 * Quy tắc: chỉ những thứ THỰC SỰ dùng chung mới được nằm ở đây. Nếu một helper chỉ có một
 * module dùng, nó thuộc về module đó — `common` phình lên thành thùng rác là cách nhanh
 * nhất để mất ranh giới module.
 */
export { DomainError } from './errors/domain.error';
export { AllExceptionsFilter } from './filters/all-exceptions.filter';
export { ZodValidationPipe } from './pipes/zod-validation.pipe';
export { LoggerModule, CORRELATION_ID_HEADER } from './logger/logger.module';
