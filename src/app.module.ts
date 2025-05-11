// src/app.module.ts
import { Module } from '@nestjs/common';
import { DeepseekModule } from './deepseek/deepseek.module';

@Module({
  imports: [DeepseekModule],
})
export class AppModule {}