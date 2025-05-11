// test/integration/deepseek/deepseek.http.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '@src/app.module';
import { DeepseekService } from '@src/deepseek/deepseek.service';

describe('DeepseekController (integration)', () => {
  let app: INestApplication;
  let deepseekService: DeepseekService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env',
        }),
        AppModule, // 确保 AppModule 导入了 DeepseekModule
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    deepseekService = moduleFixture.get<DeepseekService>(DeepseekService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should receive streamed data', (done) => {
    request(app.getHttpServer())
      .post('/deepseek/chat/completions')
      .send({ prompt: 'hello' })
      .set('Accept', 'text/event-stream')
      .buffer(true)
      .parse((res, cb) => {
        res.setEncoding('utf8');
        let result = '';
        res.on('data', (chunk) => {
          result += chunk;
          if (chunk.includes('[DONE]')) {
            expect(result).toContain('data:');
            done();
          }
        });
      });
  }, 30000);

  // describe('POST /deepseek/chat/completions', () => {
  //   it('should return 200 with valid request', async () => {
  //     const response = await request(app.getHttpServer())
  //       .post('/deepseek/chat/completions')
  //       .send({
  //         prompt: 'hello 的中文是什么意思？',
  //         max_tokens: 100,
  //       })
  //       .expect(HttpStatus.OK);

  //     console.dir(response.body, { depth: null });
  //   });
  // });
});
