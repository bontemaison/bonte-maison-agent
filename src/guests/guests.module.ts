import { Module } from '@nestjs/common';
import { HoldsModule } from '../holds/holds.module';
import { GuestsService } from './guests.service';

@Module({
  imports: [HoldsModule],
  providers: [GuestsService],
  exports: [GuestsService],
})
export class GuestsModule {}
