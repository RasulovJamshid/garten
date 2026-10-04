ALTER TABLE "attendance_day" ADD COLUMN "pickup_guardian_id" UUID;
ALTER TABLE "attendance_day" ADD CONSTRAINT "fk_att_pickup_guardian" FOREIGN KEY ("pickup_guardian_id") REFERENCES "guardian"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
