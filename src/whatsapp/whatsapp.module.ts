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
        // `dualhook` uses the same Cloud API wire format, so it shares
        // CloudApiProvider — the provider itself swaps the outbound host to
        // api.dualhook.com and the bearer to DUALHOOK_LIVE_KEY.
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
