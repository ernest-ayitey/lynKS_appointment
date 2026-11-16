/*
  Warnings:

  - A unique constraint covering the columns `[phone]` on the table `StaffUser` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX `StaffUser_phone_key` ON `StaffUser`(`phone`);
