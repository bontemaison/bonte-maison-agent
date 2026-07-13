import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as cron from 'node-cron';
import { LoggerService } from '../logger/logger.service';
import { ConversationService } from './conversation.service';

@Injectable()
export class ConversationCronService implements OnModuleInit, OnModuleDestroy {
  private task: cron.ScheduledTask | null = null;

  constructor(
    private readonly conversation: ConversationService,
    private readonly logger: LoggerService,
  ) {}

  onModuleInit(): void {
    // Every minute: flip conversations whose pause window (human takeover or
    // timed /pause) has lapsed back to `bot` in Airtable. The read path resumes
    // the bot the instant the window ends; this sweep keeps the CRM tidy.
    this.task = cron.schedule('* * * * *', () => {
      this.runResumeSweep().catch((err: Error) => {
        this.logger.error('conversation', 'cron runResumeSweep failed', {
          error: err.message,
        });
      });
    });
    this.logger.info(
      'conversation',
      'resume-sweep cron scheduled (every minute)',
    );
  }

  onModuleDestroy(): void {
    this.task?.stop();
  }

  async runResumeSweep(): Promise<void> {
    this.logger.debug('conversation', 'resume sweep: tick');
    const resumed = await this.conversation.resumeExpired();
    if (resumed > 0) {
      this.logger.info('conversation', 'resume sweep', { resumed });
    }
  }
}
