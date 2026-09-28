CREATE TYPE "public"."import_mode" AS ENUM('CREATE_ONLY', 'UPSERT');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."import_stock_mode" AS ENUM('SET', 'ADD');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('CASH', 'PIX', 'DEBIT_CARD', 'CREDIT_CARD', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."role_scope" AS ENUM('GLOBAL', 'STORE');--> statement-breakpoint
CREATE TYPE "public"."sale_status" AS ENUM('COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."service_order_status" AS ENUM('AWAITING_APPROVAL', 'IN_PROGRESS', 'COMPLETED', 'DELIVERED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_type" AS ENUM('IMPORT', 'ADJUSTMENT', 'SALE', 'SALE_CANCEL', 'SERVICE_ORDER', 'SERVICE_ORDER_REVERSAL', 'TRANSFER_OUT', 'TRANSFER_IN', 'TRANSFER_RETURN');--> statement-breakpoint
CREATE TYPE "public"."transfer_status" AS ENUM('IN_TRANSIT', 'RECEIVED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "counters" (
	"scope" varchar(80) PRIMARY KEY NOT NULL,
	"value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"phone" varchar(20),
	"email" varchar(160),
	"document" varchar(14),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"file_name" varchar(255) NOT NULL,
	"file_type" varchar(10) NOT NULL,
	"mode" "import_mode" NOT NULL,
	"stock_mode" "import_stock_mode" NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"status" "import_status" NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"stock_entries" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" varchar(64) NOT NULL,
	"barcode" varchar(64),
	"name" varchar(200) NOT NULL,
	"description" text,
	"category" varchar(80),
	"brand" varchar(80),
	"compatible_models" text,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"min_stock" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku"),
	CONSTRAINT "products_prices_non_negative" CHECK ("products"."cost_cents" >= 0 and "products"."price_cents" >= 0),
	CONSTRAINT "products_min_stock_non_negative" CHECK ("products"."min_stock" >= 0)
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission" varchar(64) NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(60) NOT NULL,
	"description" text,
	"scope" "role_scope" DEFAULT 'STORE' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sale_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"description" varchar(200) NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"unit_cost_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	CONSTRAINT "sale_items_quantity_positive" CHECK ("sale_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "sale_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount_cents" integer NOT NULL,
	CONSTRAINT "sale_payments_amount_positive" CHECK ("sale_payments"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"customer_id" uuid,
	"user_id" uuid NOT NULL,
	"status" "sale_status" DEFAULT 'COMPLETED' NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"paid_cents" integer NOT NULL,
	"change_cents" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" uuid,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_store_number_uq" UNIQUE("store_id","number")
);
--> statement-breakpoint
CREATE TABLE "service_order_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_order_id" uuid NOT NULL,
	"from_status" "service_order_status",
	"to_status" "service_order_status" NOT NULL,
	"user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"description" varchar(200) NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"unit_cost_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	CONSTRAINT "service_order_items_quantity_positive" CHECK ("service_order_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "service_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"customer_id" uuid NOT NULL,
	"technician_id" uuid,
	"created_by_id" uuid NOT NULL,
	"status" "service_order_status" DEFAULT 'AWAITING_APPROVAL' NOT NULL,
	"device_brand" varchar(60),
	"device_model" varchar(120) NOT NULL,
	"device_serial" varchar(40),
	"device_condition" text,
	"accessories" text,
	"reported_defect" text NOT NULL,
	"diagnosis" text,
	"notes" text,
	"labor_cents" integer DEFAULT 0 NOT NULL,
	"parts_cents" integer DEFAULT 0 NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"warranty_days" integer DEFAULT 90 NOT NULL,
	"estimated_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"stock_deducted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_orders_store_number_uq" UNIQUE("store_id","number"),
	CONSTRAINT "service_orders_amounts_non_negative" CHECK ("service_orders"."labor_cents" >= 0 and "service_orders"."parts_cents" >= 0 and "service_orders"."discount_cents" >= 0 and "service_orders"."total_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_levels" (
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_levels_store_id_product_id_pk" PRIMARY KEY("store_id","product_id"),
	CONSTRAINT "stock_levels_quantity_non_negative" CHECK ("stock_levels"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"type" "stock_movement_type" NOT NULL,
	"quantity" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reference_type" varchar(30),
	"reference_id" uuid,
	"user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_transfer_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "stock_transfer_items_quantity_positive" CHECK ("stock_transfer_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer NOT NULL,
	"from_store_id" uuid NOT NULL,
	"to_store_id" uuid NOT NULL,
	"status" "transfer_status" DEFAULT 'IN_TRANSIT' NOT NULL,
	"notes" text,
	"created_by_id" uuid NOT NULL,
	"received_by_id" uuid,
	"cancelled_by_id" uuid,
	"received_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transfers_number_unique" UNIQUE("number"),
	CONSTRAINT "stock_transfers_distinct_stores" CHECK ("stock_transfers"."from_store_id" <> "stock_transfers"."to_store_id")
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(12) NOT NULL,
	"name" varchar(120) NOT NULL,
	"document" varchar(20),
	"phone" varchar(20),
	"address" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"email" varchar(160) NOT NULL,
	"password_hash" text NOT NULL,
	"role_id" uuid NOT NULL,
	"store_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_cancelled_by_id_users_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_history" ADD CONSTRAINT "service_order_history_service_order_id_service_orders_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_history" ADD CONSTRAINT "service_order_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_items" ADD CONSTRAINT "service_order_items_service_order_id_service_orders_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_items" ADD CONSTRAINT "service_order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_technician_id_users_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_transfer_id_stock_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."stock_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_store_id_stores_id_fk" FOREIGN KEY ("from_store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_store_id_stores_id_fk" FOREIGN KEY ("to_store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_received_by_id_users_id_fk" FOREIGN KEY ("received_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_cancelled_by_id_users_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_document_uq" ON "customers" USING btree ("document") WHERE "customers"."document" is not null;--> statement-breakpoint
CREATE INDEX "import_jobs_created_idx" ON "import_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "products_barcode_uq" ON "products" USING btree ("barcode") WHERE "products"."barcode" is not null;--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category");--> statement-breakpoint
CREATE INDEX "sale_items_sale_idx" ON "sale_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_items_product_idx" ON "sale_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sale_payments_sale_idx" ON "sale_payments" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sales_store_created_idx" ON "sales" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "service_order_history_order_idx" ON "service_order_history" USING btree ("service_order_id","created_at");--> statement-breakpoint
CREATE INDEX "service_order_items_order_idx" ON "service_order_items" USING btree ("service_order_id");--> statement-breakpoint
CREATE INDEX "service_orders_store_status_idx" ON "service_orders" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "service_orders_store_created_idx" ON "service_orders" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "service_orders_customer_idx" ON "service_orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "stock_levels_product_idx" ON "stock_levels" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "stock_movements_store_product_idx" ON "stock_movements" USING btree ("store_id","product_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_reference_idx" ON "stock_movements" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "stock_transfer_items_transfer_idx" ON "stock_transfer_items" USING btree ("transfer_id");--> statement-breakpoint
CREATE INDEX "stock_transfers_from_idx" ON "stock_transfers" USING btree ("from_store_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_transfers_to_idx" ON "stock_transfers" USING btree ("to_store_id","created_at");--> statement-breakpoint
CREATE INDEX "users_store_idx" ON "users" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role_id");