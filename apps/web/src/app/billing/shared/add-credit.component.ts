import { DIALOG_DATA, DialogConfig, DialogRef } from "@angular/cdk/dialog";
import { Component, ElementRef, Inject, OnInit, ViewChild } from "@angular/core";
import { FormControl, FormGroup, Validators } from "@angular/forms";
import { firstValueFrom } from "rxjs";

import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { OrganizationService } from "@bitwarden/common/admin-console/abstractions/organization/organization.service.abstraction";
import { PaymentMethodType } from "@bitwarden/common/billing/enums";
import { BitPayInvoiceRequest } from "@bitwarden/common/billing/models/request/bit-pay-invoice.request";
import { ConfigServiceAbstraction } from "@bitwarden/common/platform/abstractions/config/config.service.abstraction";
import { PayPalConfig } from "@bitwarden/common/platform/abstractions/environment.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { StateService } from "@bitwarden/common/platform/abstractions/state.service";
import { DialogService } from "@bitwarden/components";

export interface AddCreditDialogData {
  organizationId: string;
}

export enum AddCreditDialogResult {
  Added = "added",
  Cancelled = "cancelled",
}

@Component({
  selector: "app-add-credit",
  templateUrl: "add-credit.component.html",
})
export class AddCreditComponent implements OnInit {
  @ViewChild("ppButtonForm", { read: ElementRef, static: true }) ppButtonFormRef: ElementRef;

  paymentMethodType = PaymentMethodType;
  ppButtonFormAction: string;
  ppButtonBusinessId: string;
  ppButtonCustomField: string;
  ppLoading = false;
  subject: string;
  returnUrl: string;
  organizationId: string;

  private userId: string;
  private name: string;
  private email: string;
  private region: string;

  protected formGroup = new FormGroup({
    method: new FormControl(PaymentMethodType.PayPal),
    creditAmount: new FormControl(null, [Validators.required]),
  });

  constructor(
    private dialogRef: DialogRef,
    @Inject(DIALOG_DATA) protected data: AddCreditDialogData,
    private stateService: StateService,
    private apiService: ApiService,
    private platformUtilsService: PlatformUtilsService,
    private organizationService: OrganizationService,
    private logService: LogService,
    private configService: ConfigServiceAbstraction,
  ) {
    this.organizationId = data.organizationId;
    const payPalConfig = process.env.PAYPAL_CONFIG as PayPalConfig;
    this.ppButtonFormAction = payPalConfig.buttonAction;
    this.ppButtonBusinessId = payPalConfig.businessId;
  }

  async ngOnInit() {
    if (this.organizationId != null) {
      if (this.formGroup.value.creditAmount == null) {
        this.formGroup.get("creditAmount").setValue("20.00");
      }
      this.ppButtonCustomField = "organization_id:" + this.organizationId;
      const org = await this.organizationService.get(this.organizationId);
      if (org != null) {
        this.subject = org.name;
        this.name = org.name;
      }
    } else {
      if (this.formGroup.value.creditAmount == null) {
        this.formGroup.get("creditAmount").setValue("10.00");
      }
      this.userId = await this.stateService.getUserId();
      this.subject = await this.stateService.getEmail();
      this.email = this.subject;
      this.ppButtonCustomField = "user_id:" + this.userId;
    }
    this.region = await firstValueFrom(this.configService.cloudRegion$);
    this.ppButtonCustomField += ",account_credit:1";
    this.ppButtonCustomField += `,region:${this.region}`;
    this.returnUrl = window.location.href;
  }

  submit = async () => {
    if (this.formGroup.value.creditAmount == null || this.formGroup.value.creditAmount === "") {
      return;
    }

    if (this.formGroup.value.method === PaymentMethodType.PayPal) {
      this.ppButtonFormRef.nativeElement.submit();
      this.ppLoading = true;
      return;
    }
    if (this.formGroup.value.method === PaymentMethodType.BitPay) {
      try {
        const req = new BitPayInvoiceRequest();
        req.email = this.email;
        req.name = this.name;
        req.credit = true;
        req.amount = this.creditAmountNumber;
        req.organizationId = this.organizationId;
        req.userId = this.userId;
        req.returnUrl = this.returnUrl;
        const response = this.apiService.postBitPayInvoice(req);
        const bitPayUrl: string = await response;
        this.platformUtilsService.launchUri(bitPayUrl);
      } catch (e) {
        this.logService.error(e);
        throw e;
      }
      return;
    }
    try {
      this.dialogRef.close(AddCreditDialogResult.Added);
    } catch (e) {
      this.logService.error(e);
    }
  };

  cancel() {
    this.dialogRef.close(AddCreditDialogResult.Cancelled);
  }

  formatAmount() {
    try {
      if (this.formGroup.value.creditAmount != null && this.formGroup.value.creditAmount !== "") {
        const floatAmount = Math.abs(parseFloat(this.formGroup.value.creditAmount));
        if (floatAmount > 0) {
          const formattedAmount = parseFloat((Math.round(floatAmount * 100) / 100).toString())
            .toFixed(2)
            .toString();
          this.formGroup.get("creditAmount").setValue(formattedAmount);
          return;
        }
      }
    } catch (e) {
      this.logService.error(e);
    }
    this.formGroup.get("creditAmount").setValue("");
  }

  get creditAmountNumber(): number {
    if (this.formGroup.value.creditAmount != null && this.formGroup.value.creditAmount !== "") {
      try {
        return parseFloat(this.formGroup.value.creditAmount);
      } catch (e) {
        this.logService.error(e);
      }
    }
    return null;
  }
}

/**
 * Strongly typed helper to open a AddCreditDialog
 * @param dialogService Instance of the dialog service that will be used to open the dialog
 * @param config Configuration for the dialog
 */
export function openAddCreditDialog(
  dialogService: DialogService,
  config: DialogConfig<AddCreditDialogData>,
) {
  return dialogService.open<AddCreditDialogResult>(AddCreditComponent, config);
}
