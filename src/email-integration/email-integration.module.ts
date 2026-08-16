import { Module } from '@nestjs/common';
import { AirtableModule } from '../airtable/airtable.module';
import { FollowUpsModule } from '../follow-ups/follow-ups.module';
import { GuestsModule } from '../guests/guests.module';
import { LoggerModule } from '../logger/logger.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TemplatesModule } from '../templates/templates.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { EmailWatcherService } from './email-watcher.service';
import { NudgeDispatcherService } from './nudge-dispatcher.service';

@Module({
  imports: [
    AirtableModule,
    LoggerModule,
    TemplatesModule,
    WhatsappModule,
    NotificationsModule,
    GuestsModule,
    FollowUpsModule,
  ],
  providers: [EmailWatcherService, NudgeDispatcherService],
  exports: [EmailWatcherService, NudgeDispatcherService],
})
export class EmailIntegrationModule {}
