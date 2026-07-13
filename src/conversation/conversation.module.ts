import { Global, Module } from '@nestjs/common';
import { ConversationCronService } from './conversation-cron.service';
import { ConversationService } from './conversation.service';

@Global()
@Module({
  providers: [ConversationService, ConversationCronService],
  exports: [ConversationService],
})
export class ConversationModule {}
