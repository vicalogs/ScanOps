// src/deepseek/dto/response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class ResponseDto {
  @ApiProperty({ description: '请求是否成功' })
  success: boolean;

  @ApiProperty({ description: '返回数据' })
  data: any;

  @ApiProperty({ 
    description: '可选消息',
    required: false,
  })
  message?: string;
}