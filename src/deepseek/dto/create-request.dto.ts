// src/deepseek/dto/create-request.dto.ts
import { 
    IsString, 
    IsNotEmpty, 
    IsOptional, 
    IsNumber, 
    Min, 
    Max 
  } from 'class-validator';
  import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
  
  export class CreateRequestDto {
    @ApiProperty({ description: '输入的提示文本' })
    @IsString()
    @IsNotEmpty()
    prompt: string;
  
    @ApiPropertyOptional({ 
      description: '使用的模型名称',
      default: 'deepseek-chat',
    })
    @IsString()
    @IsOptional()
    model?: string;
  
    @ApiPropertyOptional({ 
      description: '最大token数',
      minimum: 1,
      maximum: 4096,
      default: 2048,
    })
    @IsNumber()
    @IsOptional()
    @Min(1)
    @Max(4096)
    max_tokens?: number;
  
    @ApiPropertyOptional({ 
      description: '温度参数(0-2)',
      minimum: 0,
      maximum: 2,
      default: 0.7,
    })
    @IsNumber()
    @IsOptional()
    @Min(0)
    @Max(2)
    temperature?: number;
  }