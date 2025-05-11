// src/deepseek/deepseek.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { CreateRequestDto } from './dto/create-request.dto';

@Injectable()
export class DeepseekService {
  private readonly logger = new Logger(DeepseekService.name);
  private openai: OpenAI;

  constructor(private configService: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.configService.get('DEEPSEEK_API_KEY'),
      baseURL: this.configService.get('DEEPSEEK_API_URL'), // DeepSeek 的 OpenAI 兼容端点
    });
  }

  async createCompletion(createRequestDto: CreateRequestDto) {
    try {
      this.logger.log(`Creating completion for: ${createRequestDto.prompt}`);

      const stream = await this.openai.chat.completions.create({
        model: createRequestDto.model || 'deepseek-chat',
        messages: [{ role: 'user', content: createRequestDto.prompt }],
        max_tokens: createRequestDto.max_tokens,
        temperature: createRequestDto.temperature,
        stream: true,
      });
      async function* handleStream() {
        for await (const chunk of stream as any) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        }
      }
  
      return handleStream();
      // return  response.choices[0].message.content;
      // return {
      //   id: response.id,
      //   content: response.choices[0].message.content,
      //   usage: response.usage,
      // };
    } catch (error) {
      this.logger.error('Error calling DeepSeek API', error.stack);
      throw error;
    }
  }
}