import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger/logger.service';
import { CloudApiProvider } from './providers/cloud-api.provider';
import { WatiProvider } from './providers/wati.provider';
import { WebhookController } from './webhook.controller';
import { WHATSAPP_PROVIDER, WhatsappService } from './whatsapp.service';

@Global()
@Module({
  controllers: [WebhookController],
  providers: [
    {
      provide: WHATSAPP_PROVIDER,
      useFactory: (config: ConfigService, logger: LoggerService) => {
        const providerName = config.get<string>('WHATSAPP_PROVIDER') ?? 'cloud_api';
        logger.info('whatsapp', `using provider: ${providerName}`, {});
        // `dualhook` is a deployment configuration on top of Meta Cloud API
        // (webhook override + embedded signup). At the wire level it's
        // identical to cloud_api, so we accept it as an alias here.
        if (providerName === 'wati') return new WatiProvider(config, logger);
        return new CloudApiProvider(config, logger);
      },
      inject: [ConfigService, LoggerService],
    },
    WhatsappService,
  ],
  exports: [WhatsappService],
})
export class WhatsappModule {}
