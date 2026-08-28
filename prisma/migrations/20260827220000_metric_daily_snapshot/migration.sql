CREATE TABLE "MetricDailySnapshot" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "aiTokensTotal" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricDailySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetricDailySnapshot_date_key" ON "MetricDailySnapshot"("date");
