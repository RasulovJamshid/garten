import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RbacModule } from './rbac/rbac.module';
import { PermissionGuard } from './rbac/permission.guard';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { RolesModule } from './roles/roles.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './admin/admin.module';
import { ChildrenModule } from './children/children.module';
import { GuardiansModule } from './guardians/guardians.module';
import { GroupsModule } from './groups/groups.module';
import { AttendanceModule } from './attendance/attendance.module';
import { PickupModule } from './pickup/pickup.module';
import { MoneyModule } from './money/money.module';
import { BillingModule } from './billing/billing.module';
import { PaymentsModule } from './payments/payments.module';
import { DebtsModule } from './debts/debts.module';
import { ExpensesModule } from './expenses/expenses.module';
import { StorageModule } from './storage/storage.module';
import { FilesModule } from './files/files.module';
import { JobsModule } from './jobs/jobs.module';
import { TelegramModule } from './telegram/telegram.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportsModule } from './reports/reports.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ImportsModule } from './imports/imports.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TraceIdMiddleware } from './common/middleware/trace-id.middleware';

@Module({
  imports: [
    // api-spec §2 "Rate limits": everything else defaults to 300/min,
    // keyed per-user (AppThrottlerGuard) rather than the library's
    // default IP-only tracker — see that guard's comment for why.
    // Per-route overrides (login 5/min/IP, notification sends
    // 20/min/tenant) live as @Throttle() decorators on those handlers.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
    }),
    AppConfigModule,
    PrismaModule,
    AuthModule,
    RbacModule,
    AuditModule,
    HealthModule,
    RolesModule,
    UsersModule,
    AdminModule,
    ChildrenModule,
    GuardiansModule,
    GroupsModule,
    AttendanceModule,
    PickupModule,
    MoneyModule,
    BillingModule,
    PaymentsModule,
    DebtsModule,
    ExpensesModule,
    StorageModule,
    FilesModule,
    JobsModule,
    TelegramModule,
    NotificationsModule,
    ReportsModule,
    DashboardModule,
    ImportsModule,
  ],
  providers: [
    // Order is the contract: JwtAuthGuard sets req.user, AppThrottlerGuard
    // reads it to key per-user limits, PermissionGuard runs last. Wired
    // here, explicitly, rather than split across modules where import
    // order would decide it implicitly.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceIdMiddleware).forRoutes('*');
  }
}
