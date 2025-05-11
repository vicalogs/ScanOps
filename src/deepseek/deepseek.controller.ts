// src/deepseek/deepseek.controller.ts
import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UseFilters,
  Logger,
  Res
} from '@nestjs/common';
import { Response } from 'express';
import { DeepseekService } from './deepseek.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { TransformInterceptor } from '../common/interceptors/transform.interceptor';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { ApiOperation, ApiResponse, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ResponseDto } from './dto/response.dto';

@ApiTags('DeepSeek') // Swagger 标签
@ApiBearerAuth() // Swagger 认证标记
@Controller('deepseek')
@UseInterceptors(TransformInterceptor) // 全局响应格式转换
@UseFilters(HttpExceptionFilter) // 全局异常处理
export class DeepseekController {
  private readonly logger = new Logger(DeepseekController.name);

  constructor(private readonly deepseekService: DeepseekService) { }

  @Post('chat/completions')
  async stream(@Body('prompt') prompt: string, @Res() res: Response, @Body() createRequestDto: CreateRequestDto) {

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await this.deepseekService.createCompletion(createRequestDto);

    for await (const chunk of stream) {
      res.write(`data: ${chunk}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }


  // @Post('chat/completions')
  // @HttpCode(HttpStatus.OK) // 明确返回状态码
  // @ApiOperation({ summary: '创建聊天补全', description: '调用DeepSeek API生成响应' })
  // @ApiResponse({
  //   status: HttpStatus.OK,
  //   description: '成功响应',
  //   type: ResponseDto,
  // })
  // @ApiResponse({
  //   status: HttpStatus.BAD_REQUEST,
  //   description: '无效请求参数'
  // })
  // @ApiResponse({
  //   status: HttpStatus.UNAUTHORIZED,
  //   description: '未授权访问'
  // })
  // async createCompletion(
  //   @Body() createRequestDto: CreateRequestDto,
  // ): Promise<ResponseDto> {
  //   this.logger.log(
  //     `Received completion request with model: ${createRequestDto.model || 'default'}`,
  //   );

  //   try {

  //     const result = await this.deepseekService.createCompletion(createRequestDto);

  //     return {
  //       success: true,
  //       data: result,
  //       message: 'Success'
  //     };
  //   } catch (error) {
  //     this.logger.error(
  //       `Failed to create completion: ${error.message}`,
  //       error.stack,
  //     );
  //     throw error; // 异常过滤器会处理
  //   }
  // }
}