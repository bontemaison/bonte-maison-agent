import { Global, Module } from '@nestjs/common';
import { BookingRulesModule } from '../booking-rules/booking-rules.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { EmailService } from './email.service';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  imports: [WhatsappModule, BookingRulesModule],
  providers: [EmailService, NotificationsService],
  exports: [NotificationsService, EmailService],
})
export class NotificationsModule {}
