import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TelegramModule } from '../telegram/telegram.module';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationTemplatesService } from './notification-templates.service';
import { NotificationTemplatesController } from './notification-templates.controller';
import { AnnouncementsService } from './announcements.service';
import { AnnouncementsController } from './announcements.controller';
import { NotificationWorkerService } from './notification-worker.service';
import { DebtReminderService } from './debt-reminder.service';

@Module({
  imports: [AuditModule, TelegramModule],
  controllers: [NotificationsController, NotificationTemplatesController, AnnouncementsController],
  providers: [
    NotificationsService,
    NotificationTemplatesService,
    AnnouncementsService,
    NotificationWorkerService,
    DebtReminderService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
