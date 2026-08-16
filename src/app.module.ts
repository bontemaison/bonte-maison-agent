import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AirtableModule } from './airtable/airtable.module';
import { AvailabilityModule } from './availability/availability.module';
import { BookingRulesModule } from './booking-rules/booking-rules.module';
import { ComposerModule } from './composer/composer.module';
import { ConversationModule } from './conversation/conversation.module';
import { EmailIntegrationModule } from './email-integration/email-integration.module';
import { FollowUpsModule } from './follow-ups/follow-ups.module';
import { FragmentsModule } from './fragments/fragments.module';
import { GuestsModule } from './guests/guests.module';
import { HelpersModule } from './helpers/helpers.module';
import { HoldsModule } from './holds/holds.module';
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module';
import { LoggerModule } from './logger/logger.module';
import { MessageLogModule } from './messagelog/messagelog.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrchestratorModule } from './orchestrator/orchestrator.module';
import { ParserModule } from './parser/parser.module';
import { PricingModule } from './pricing/pricing.module';
import { TemplatesModule } from './templates/templates.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule,
    AirtableModule,
    AvailabilityModule,
    BookingRulesModule,
    PricingModule,
    TemplatesModule,
    KnowledgeBaseModule,
    FragmentsModule,
    HelpersModule,
    ComposerModule,
    ParserModule,
    ConversationModule,
    MessageLogModule,
    WhatsappModule,
    HoldsModule,
    GuestsModule,
    FollowUpsModule,
    NotificationsModule,
    EmailIntegrationModule,
    OrchestratorModule,
  ],
})
export class AppModule {}
