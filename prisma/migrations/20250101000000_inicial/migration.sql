-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ModoPublicacion" AS ENUM ('DESCARGA', 'BORRADOR_TIKTOK', 'DIRECTO_TIKTOK');

-- CreateEnum
CREATE TYPE "EstadoHistoria" AS ENUM ('GUION', 'CLIPS', 'VOZ', 'RENDER', 'LISTA', 'SUBIDA', 'ERROR');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Serie" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "temas" TEXT[],
    "duracion" INTEGER NOT NULL DEFAULT 65,
    "cron" TEXT NOT NULL,
    "zonaHoraria" TEXT NOT NULL DEFAULT 'America/Lima',
    "motor" TEXT NOT NULL DEFAULT 'groq',
    "voz" JSONB NOT NULL,
    "musica" TEXT,
    "modoPublicacion" "ModoPublicacion" NOT NULL DEFAULT 'DESCARGA',
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Serie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Historia" (
    "id" TEXT NOT NULL,
    "serieId" TEXT,
    "estado" "EstadoHistoria" NOT NULL DEFAULT 'GUION',
    "titulo" TEXT,
    "guion" JSONB,
    "escenas" JSONB,
    "descripcion" TEXT,
    "archivo" TEXT,
    "publishId" TEXT,
    "error" TEXT,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Historia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TikTokCuenta" (
    "id" TEXT NOT NULL,
    "openId" TEXT NOT NULL,
    "nombre" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT NOT NULL,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TikTokCuenta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Historia_serieId_creadaEn_idx" ON "Historia"("serieId", "creadaEn");

-- CreateIndex
CREATE INDEX "Historia_estado_idx" ON "Historia"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "TikTokCuenta_openId_key" ON "TikTokCuenta"("openId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Historia" ADD CONSTRAINT "Historia_serieId_fkey" FOREIGN KEY ("serieId") REFERENCES "Serie"("id") ON DELETE SET NULL ON UPDATE CASCADE;

