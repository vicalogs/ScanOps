// src/deepseek/deepseek.module.ts
import { Module } from '@nestjs/common';
import { DeepseekController } from './deepseek.controller';
import { DeepseekService } from './deepseek.service';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    ConfigModule,
    HttpModule,
  ],
  controllers: [DeepseekController],
  providers: [DeepseekService],
  exports: [DeepseekService], // 如果其他模块需要使用
})
export class DeepseekModule {}