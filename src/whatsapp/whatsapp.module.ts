import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger/logger.service';
import { CloudApiProvider } from './providers/cloud-api.provider';
import { WebhookController } from './webhook.controller';
import { WHATSAPP_PROVIDER, WhatsappService } from './whatsapp.service';

@Global()
@Module({
  controllers: [WebhookController],
  providers: [
    {
      provide: WHATSAPP_PROVIDER,
      useFactory: (config: ConfigService, logger: LoggerService) =>
        new CloudApiProvider(config, logger),
      inject: [ConfigService, LoggerService],
    },
    WhatsappService,
  ],
  exports: [WhatsappService],
})
export class WhatsappModule {}
