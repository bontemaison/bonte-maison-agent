import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type LogModule =
  | 'whatsapp'
  | 'parser'
  | 'availability'
  | 'pricing'
  | 'templates'
  | 'response'
  | 'conversation'
  | 'messagelog'
  | 'knowledge-base'
  | 'holds'
  | 'guests'
  | 'follow-ups'
  | 'notifications'
  | 'email-integration'
  | 'booking-rules'
  | 'airtable';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const RESET = '\x1b[0m';
const RED = '\x1b[31m';

const MODULE_COLOR: Record<LogModule, string> = {
  whatsapp: '\x1b[36m',
  parser: '\x1b[35m',
  availability: '\x1b[34m',
  pricing: '\x1b[33m',
  templates: '\x1b[32m',
  response: '\x1b[92m',
  conversation: '\x1b[37m',
  messagelog: '\x1b[96m',
  'knowledge-base': '\x1b[93m',
  holds: '\x1b[93m',
  guests: '\x1b[97m',
  'follow-ups': '\x1b[94m',
  notifications: '\x1b[92m',
  'email-integration': '\x1b[95m',
  'booking-rules': '\x1b[96m',
  airtable: '\x1b[90m',
};

@Injectable()
export class LoggerService {
  private readonly minWeight: number;

  constructor(config: ConfigService) {
    const raw = (config.get<string>('LOG_LEVEL') ?? 'info') as LogLevel;
    this.minWeight = LEVEL_WEIGHT[raw] ?? LEVEL_WEIGHT.info;
  }

  debug(module: LogModule, message: string, meta?: unknown): void {
    this.emit('debug', module, message, meta);
  }

  info(module: LogModule, message: string, meta?: unknown): void {
    this.emit('info', module, message, meta);
  }

  warn(module: LogModule, message: string, meta?: unknown): void {
    this.emit('warn', module, message, meta);
  }

  error(module: LogModule, message: string, meta?: unknown): void {
    this.emit('error', module, message, meta);
  }

  private emit(
    level: LogLevel,
    module: LogModule,
    message: string,
    meta?: unknown,
  ): void {
    if (LEVEL_WEIGHT[level] < this.minWeight) return;

    const color = level === 'error' ? RED : MODULE_COLOR[module];
    const ts = new Date().toISOString();
    const metaStr = meta !== undefined ? ' ' + JSON.stringify(meta) : '';
    const line = `${color}[${ts}] ${level.toUpperCase()} [${module}] ${message}${metaStr}${RESET}\n`;

    if (level === 'warn' || level === 'error') {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  }
}
