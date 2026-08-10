import { Global, Module } from '@nestjs/common';
import { BookingRulesModule } from '../booking-rules/booking-rules.module';
import { ComposerModule } from '../composer/composer.module';
import { FollowUpsModule } from '../follow-ups/follow-ups.module';
import { FragmentsModule } from '../fragments/fragments.module';
import { GuestsModule } from '../guests/guests.module';
import { HelpersModule } from '../helpers/helpers.module';
import { HoldsModule } from '../holds/holds.module';
import { TemplatesModule } from '../templates/templates.module';
import { MessageHandlerService } from './message-handler.service';

@Global()
@Module({
  imports: [
    BookingRulesModule,
    HoldsModule,
    GuestsModule,
    FollowUpsModule,
    TemplatesModule,
    ComposerModule,
    FragmentsModule,
    HelpersModule,
  ],
  providers: [MessageHandlerService],
  exports: [MessageHandlerService],
})
export class OrchestratorModule {}
