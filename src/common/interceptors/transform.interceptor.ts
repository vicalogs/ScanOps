// src/common/interceptors/transform.interceptor.ts
import {
    CallHandler,
    ExecutionContext,
    Injectable,
    NestInterceptor,
  } from '@nestjs/common';
  import { Observable } from 'rxjs';
  import { map } from 'rxjs/operators';
  import { ResponseDto } from '../../deepseek/dto/response.dto';
  
  @Injectable()
  export class TransformInterceptor<T>
    implements NestInterceptor<T, ResponseDto>
  {
    intercept(
      context: ExecutionContext,
      next: CallHandler,
    ): Observable<ResponseDto> {
      return next.handle().pipe(
        map((data) => ({
          success: true,
          data,
        })),
      );
    }
  }