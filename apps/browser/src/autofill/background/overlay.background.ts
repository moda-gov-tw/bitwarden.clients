import { SettingsService } from "@bitwarden/common/abstractions/settings.service";
import { WebsiteIconData } from "@bitwarden/common/abstractions/website-icon.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { StateService } from "@bitwarden/common/platform/abstractions/state.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { WebsiteIconService } from "@bitwarden/common/services/website-icon.service";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherType } from "@bitwarden/common/vault/enums/cipher-type";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { LoginUriView } from "@bitwarden/common/vault/models/view/login-uri.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";

import { openUnlockPopout } from "../../auth/popup/utils/auth-popout-window";
import LockedVaultPendingNotificationsItem from "../../background/models/lockedVaultPendingNotificationsItem";
import { BrowserApi } from "../../platform/browser/browser-api";
import {
  openViewVaultItemPopout,
  openAddEditVaultItemPopout,
} from "../../vault/popup/utils/vault-popout-window";
import { AutofillService, PageDetail } from "../services/abstractions/autofill.service";
import { AutofillOverlayElement, AutofillOverlayPort } from "../utils/autofill-overlay.enum";

import {
  FocusedFieldData,
  OverlayBackgroundExtensionMessageHandlers,
  OverlayButtonPortMessageHandlers,
  OverlayCipherData,
  OverlayListPortMessageHandlers,
  OverlayBackground as OverlayBackgroundInterface,
  OverlayBackgroundExtensionMessage,
  OverlayAddNewItemMessage,
} from "./abstractions/overlay.background";

class OverlayBackground implements OverlayBackgroundInterface {
  private overlayVisibility: number;
  private overlayLoginCiphers: Map<string, CipherView> = new Map();
  private pageDetailsForTab: Record<number, PageDetail[]> = {};
  private userAuthStatus: AuthenticationStatus = AuthenticationStatus.LoggedOut;
  private overlayButtonPort: chrome.runtime.Port;
  private overlayListPort: chrome.runtime.Port;
  private focusedFieldData: FocusedFieldData;
  private overlayPageTranslations: Record<string, string>;
  private readonly iconsServerUrl: string;
  private readonly extensionMessageHandlers: OverlayBackgroundExtensionMessageHandlers = {
    openAutofillOverlay: () => this.openOverlay(false),
    autofillOverlayElementClosed: ({ message }) => this.overlayElementClosed(message),
    autofillOverlayAddNewVaultItem: ({ message, sender }) => this.addNewVaultItem(message, sender),
    getAutofillOverlayVisibility: () => this.getOverlayVisibility(),
    checkAutofillOverlayFocused: () => this.checkOverlayFocused(),
    focusAutofillOverlayList: () => this.focusOverlayList(),
    updateAutofillOverlayPosition: ({ message }) => this.updateOverlayPosition(message),
    updateAutofillOverlayHidden: ({ message }) => this.updateOverlayHidden(message),
    updateFocusedFieldData: ({ message }) => this.setFocusedFieldData(message),
    collectPageDetailsResponse: ({ message, sender }) => this.storePageDetails(message, sender),
    unlockCompleted: ({ message }) => this.unlockCompleted(message),
    addEditCipherSubmitted: () => this.updateAutofillOverlayCiphers(),
    deletedCipher: () => this.updateAutofillOverlayCiphers(),
  };
  private readonly overlayButtonPortMessageHandlers: OverlayButtonPortMessageHandlers = {
    overlayButtonClicked: ({ port }) => this.handleOverlayButtonClicked(port),
    closeAutofillOverlay: ({ port }) => this.closeAutofillOverlay(port),
    overlayPageBlurred: () => this.checkOverlayListFocused(),
    redirectOverlayFocusOut: ({ message, port }) => this.redirectOverlayFocusOut(message, port),
  };
  private readonly overlayListPortMessageHandlers: OverlayListPortMessageHandlers = {
    checkAutofillOverlayButtonFocused: () => this.checkAutofillOverlayButtonFocused(),
    overlayPageBlurred: () => this.checkAutofillOverlayButtonFocused(),
    unlockVault: ({ port }) => this.unlockVault(port),
    fillSelectedListItem: ({ message, port }) => this.fillSelectedOverlayListItem(message, port),
    addNewVaultItem: ({ port }) => this.getNewVaultItemDetails(port),
    viewSelectedCipher: ({ message, port }) => this.viewSelectedCipher(message, port),
    redirectOverlayFocusOut: ({ message, port }) => this.redirectOverlayFocusOut(message, port),
  };

  constructor(
    private cipherService: CipherService,
    private autofillService: AutofillService,
    private authService: AuthService,
    private environmentService: EnvironmentService,
    private settingsService: SettingsService,
    private stateService: StateService,
    private i18nService: I18nService
  ) {
    this.iconsServerUrl = this.environmentService.getIconsUrl();
    this.initOverlayBackground();
  }

  /**
   * Removes cached page details for a tab
   * based on the passed tabId.
   *
   * @param tabId - Used to reference the page details of a specific tab
   */
  removePageDetails(tabId: number) {
    delete this.pageDetailsForTab[tabId];
  }

  /**
   * Updates the overlay list's ciphers and sends the updated list to the overlay list iframe.
   * Queries all ciphers for the given url, and sorts them by last used. Will not update the
   * list of ciphers if the extension is not unlocked.
   */
  async updateAutofillOverlayCiphers() {
    if (this.userAuthStatus !== AuthenticationStatus.Unlocked) {
      return;
    }

    const currentTab = await BrowserApi.getTabFromCurrentWindowId();
    if (!currentTab?.url) {
      return;
    }

    this.overlayLoginCiphers = new Map();
    const ciphersViews = (await this.cipherService.getAllDecryptedForUrl(currentTab.url)).sort(
      (a, b) => this.cipherService.sortCiphersByLastUsedThenName(a, b)
    );
    for (let cipherIndex = 0; cipherIndex < ciphersViews.length; cipherIndex++) {
      this.overlayLoginCiphers.set(`overlay-cipher-${cipherIndex}`, ciphersViews[cipherIndex]);
    }

    const ciphers = this.getOverlayCipherData();
    this.overlayListPort?.postMessage({ command: "updateOverlayListCiphers", ciphers });
    await BrowserApi.tabSendMessageData(currentTab, "updateIsOverlayCiphersPopulated", {
      isOverlayCiphersPopulated: Boolean(ciphers.length),
    });
  }

  /**
   * Sets up the extension message listeners and gets the settings for the
   * overlay's visibility and the user's authentication status.
   */
  private async initOverlayBackground() {
    this.setupExtensionMessageListeners();
    await this.getOverlayVisibility();
    await this.getAuthStatus();
  }

  /**
   * Strips out unnecessary data from the ciphers and returns an array of
   * objects that contain the cipher data needed for the overlay list.
   */
  private getOverlayCipherData(): OverlayCipherData[] {
    const isFaviconDisabled = this.settingsService.getDisableFavicon();
    const overlayCiphersArray = Array.from(this.overlayLoginCiphers);
    const overlayCipherData = [];
    let loginCipherIcon: WebsiteIconData;

    for (let cipherIndex = 0; cipherIndex < overlayCiphersArray.length; cipherIndex++) {
      const [overlayCipherId, cipher] = overlayCiphersArray[cipherIndex];
      if (!loginCipherIcon && cipher.type === CipherType.Login) {
        loginCipherIcon = WebsiteIconService.buildCipherIconData(
          this.iconsServerUrl,
          cipher,
          isFaviconDisabled
        );
      }

      overlayCipherData.push({
        id: overlayCipherId,
        name: cipher.name,
        type: cipher.type,
        reprompt: cipher.reprompt,
        favorite: cipher.favorite,
        icon:
          cipher.type === CipherType.Login
            ? loginCipherIcon
            : WebsiteIconService.buildCipherIconData(
                this.iconsServerUrl,
                cipher,
                isFaviconDisabled
              ),
        login:
          cipher.type === CipherType.Login
            ? { username: this.getObscureName(cipher.login.username) }
            : null,
        card:
          cipher.type === CipherType.Card
            ? { brand: cipher.card.brand, partialNumber: `*${cipher.card.number?.slice(-4)}` }
            : null,
      });
    }

    return overlayCipherData;
  }

  /**
   * Handles aggregation of page details for a tab. Stores the page details
   * in association with the tabId of the tab that sent the message.
   *
   * @param message - Message received from the `collectPageDetailsResponse` command
   * @param sender - The sender of the message
   */
  private storePageDetails(
    message: OverlayBackgroundExtensionMessage,
    sender: chrome.runtime.MessageSender
  ) {
    const pageDetails = {
      frameId: sender.frameId,
      tab: sender.tab,
      details: message.details,
    };

    if (this.pageDetailsForTab[sender.tab.id]?.length) {
      this.pageDetailsForTab[sender.tab.id].push(pageDetails);
      return;
    }

    this.pageDetailsForTab[sender.tab.id] = [pageDetails];
  }

  /**
   * Triggers autofill for the selected cipher in the overlay list. Also places
   * the selected cipher at the top of the list of ciphers.
   *
   * @param overlayCipherId - Cipher ID corresponding to the overlayLoginCiphers map. Does not correspond to the actual cipher's ID.
   * @param sender - The sender of the port message
   */
  private async fillSelectedOverlayListItem(
    { overlayCipherId }: OverlayBackgroundExtensionMessage,
    { sender }: chrome.runtime.Port
  ) {
    if (!overlayCipherId) {
      return;
    }

    const cipher = this.overlayLoginCiphers.get(overlayCipherId);

    if (await this.autofillService.isPasswordRepromptRequired(cipher, sender.tab)) {
      return;
    }
    await this.autofillService.doAutoFill({
      tab: sender.tab,
      cipher: cipher,
      pageDetails: this.pageDetailsForTab[sender.tab.id],
      fillNewPassword: true,
      allowTotpAutofill: true,
    });

    this.overlayLoginCiphers = new Map([[overlayCipherId, cipher], ...this.overlayLoginCiphers]);
  }

  /**
   * Checks if the overlay is focused. Will check the overlay list
   * if it is open, otherwise it will check the overlay button.
   */
  private checkOverlayFocused() {
    if (this.overlayListPort) {
      this.checkOverlayListFocused();

      return;
    }

    this.checkAutofillOverlayButtonFocused();
  }

  /**
   * Posts a message to the overlay button iframe to check if it is focused.
   */
  private checkAutofillOverlayButtonFocused() {
    this.overlayButtonPort?.postMessage({ command: "checkAutofillOverlayButtonFocused" });
  }

  /**
   * Posts a message to the overlay list iframe to check if it is focused.
   */
  private checkOverlayListFocused() {
    this.overlayListPort?.postMessage({ command: "checkOverlayListFocused" });
  }

  /**
   * Sends a message to the sender tab to close the autofill overlay.
   * @param sender - The sender of the port message
   */
  private closeAutofillOverlay({ sender }: chrome.runtime.Port) {
    BrowserApi.tabSendMessage(sender.tab, { command: "closeAutofillOverlay" });
  }

  /**
   * Handles cleanup when an overlay element is closed. Disconnects
   * the list and button ports and sets them to null.
   * @param overlayElement - The overlay element that was closed, either the list or button
   */
  private overlayElementClosed({ overlayElement }: OverlayBackgroundExtensionMessage) {
    if (overlayElement === AutofillOverlayElement.Button) {
      this.overlayButtonPort?.disconnect();
      this.overlayButtonPort = null;

      return;
    }

    this.overlayListPort?.disconnect();
    this.overlayListPort = null;
  }

  /**
   * Updates the position of either the overlay list or button. The position
   * is based on the focused field's position and dimensions.
   * @param overlayElement - The overlay element to update, either the list or button
   */
  private updateOverlayPosition({ overlayElement }: { overlayElement?: string }) {
    if (!overlayElement) {
      return;
    }

    if (overlayElement === AutofillOverlayElement.Button) {
      this.overlayButtonPort?.postMessage({
        command: "updateIframePosition",
        styles: this.getOverlayButtonPosition(),
      });

      return;
    }

    this.overlayListPort?.postMessage({
      command: "updateIframePosition",
      styles: this.getOverlayListPosition(),
    });
  }

  /**
   * Gets the position of the focused field and calculates the position
   * of the overlay button based on the focused field's position and dimensions.
   */
  private getOverlayButtonPosition() {
    if (!this.focusedFieldData) {
      return;
    }

    const { top, left, width, height } = this.focusedFieldData.focusedFieldRects;
    const { paddingRight, paddingLeft } = this.focusedFieldData.focusedFieldStyles;
    const elementOffset = height * 0.37;
    const elementHeight = height - elementOffset;
    const elementTopPosition = top + elementOffset / 2;
    let elementLeftPosition = left + width - height + elementOffset / 2;

    const fieldPaddingRight = parseInt(paddingRight, 10);
    const fieldPaddingLeft = parseInt(paddingLeft, 10);
    if (fieldPaddingRight > fieldPaddingLeft) {
      elementLeftPosition = left + width - height - (fieldPaddingRight - elementOffset + 2);
    }

    return {
      top: `${elementTopPosition}px`,
      left: `${elementLeftPosition}px`,
      height: `${elementHeight}px`,
      width: `${elementHeight}px`,
    };
  }

  /**
   * Gets the position of the focused field and calculates the position
   * of the overlay list based on the focused field's position and dimensions.
   */
  private getOverlayListPosition() {
    if (!this.focusedFieldData) {
      return;
    }

    const { top, left, width, height } = this.focusedFieldData.focusedFieldRects;
    return {
      width: `${width}px`,
      top: `${top + height}px`,
      left: `${left}px`,
    };
  }

  /**
   * Sets the focused field data to the data passed in the extension message.
   * @param focusedFieldData - Contains the rects and styles of the focused field.
   */
  private setFocusedFieldData({ focusedFieldData }: OverlayBackgroundExtensionMessage) {
    this.focusedFieldData = focusedFieldData;
  }

  /**
   * Updates the overlay's visibility based on the display property passed in the extension message.
   * @param display - The display property of the overlay, either "block" or "none"
   */
  private updateOverlayHidden({ display }: OverlayBackgroundExtensionMessage) {
    if (!display) {
      return;
    }

    const portMessage = { command: "updateOverlayHidden", styles: { display } };

    this.overlayButtonPort?.postMessage(portMessage);
    this.overlayListPort?.postMessage(portMessage);
  }

  private async openOverlay(isFocusingFieldElement = false, isOpeningFullOverlay = false) {
    const currentTab = await BrowserApi.getTabFromCurrentWindowId();

    await BrowserApi.tabSendMessageData(currentTab, "openAutofillOverlay", {
      isFocusingFieldElement,
      isOpeningFullOverlay,
      authStatus: await this.getAuthStatus(),
    });
  }

  private getObscureName(name: string): string {
    const [username, domain] = name.split("@");
    const usernameLength = username?.length;
    if (!usernameLength) {
      return name;
    }

    const startingCharacters = username.slice(0, usernameLength > 4 ? 2 : 1);
    let numberStars = usernameLength;
    if (usernameLength > 4) {
      numberStars = usernameLength < 6 ? numberStars - 1 : numberStars - 2;
    }

    let obscureName = `${startingCharacters}${new Array(numberStars).join("*")}`;
    if (usernameLength >= 6) {
      obscureName = `${obscureName}${username.slice(-1)}`;
    }

    return domain ? `${obscureName}@${domain}` : obscureName;
  }

  private async getOverlayVisibility(): Promise<number> {
    this.overlayVisibility = await this.settingsService.getAutoFillOverlayVisibility();

    return this.overlayVisibility;
  }

  private async getAuthStatus() {
    const formerAuthStatus = this.userAuthStatus;
    this.userAuthStatus = await this.authService.getAuthStatus();

    if (
      this.userAuthStatus !== formerAuthStatus &&
      this.userAuthStatus === AuthenticationStatus.Unlocked
    ) {
      this.updateAutofillOverlayButtonAuthStatus();
      await this.updateAutofillOverlayCiphers();
    }

    return this.userAuthStatus;
  }

  private updateAutofillOverlayButtonAuthStatus() {
    this.overlayButtonPort?.postMessage({
      command: "updateAutofillOverlayButtonAuthStatus",
      authStatus: this.userAuthStatus,
    });
  }

  private handleOverlayButtonClicked(port: chrome.runtime.Port) {
    if (this.userAuthStatus !== AuthenticationStatus.Unlocked) {
      this.unlockVault(port);
      return;
    }

    this.openOverlay(false, true);
  }

  private async unlockVault(port: chrome.runtime.Port) {
    const { sender } = port;

    this.closeAutofillOverlay(port);
    const retryMessage: LockedVaultPendingNotificationsItem = {
      commandToRetry: { msg: { command: "openAutofillOverlay" }, sender },
      target: "overlay.background",
    };
    await BrowserApi.tabSendMessageData(
      sender.tab,
      "addToLockedVaultPendingNotifications",
      retryMessage
    );
    await openUnlockPopout(sender.tab, { skipNotification: true });
  }

  private async viewSelectedCipher(
    { overlayCipherId }: OverlayBackgroundExtensionMessage,
    { sender }: chrome.runtime.Port
  ) {
    const cipher = this.overlayLoginCiphers.get(overlayCipherId);
    if (!cipher) {
      return;
    }

    await openViewVaultItemPopout(sender.tab, {
      cipherId: cipher.id,
      action: "show-autofill-button",
    });
  }

  private focusOverlayList() {
    if (!this.overlayListPort) {
      return;
    }

    this.overlayListPort.postMessage({ command: "focusOverlayList" });
  }

  private async unlockCompleted(message: OverlayBackgroundExtensionMessage) {
    await this.getAuthStatus();

    if (message.data?.commandToRetry?.msg?.command === "openAutofillOverlay") {
      await this.openOverlay(true);
    }
  }

  private getTranslations() {
    if (!this.overlayPageTranslations) {
      this.overlayPageTranslations = {
        locale: BrowserApi.getUILanguage(),
        opensInANewWindow: this.i18nService.translate("opensInANewWindow"),
        buttonPageTitle: this.i18nService.translate("bitwardenOverlayButton"),
        toggleBitwardenVaultOverlay: this.i18nService.translate("toggleBitwardenVaultOverlay"),
        listPageTitle: this.i18nService.translate("bitwardenVault"),
        unlockYourAccount: this.i18nService.translate("unlockYourAccountToViewMatchingLogins"),
        unlockAccount: this.i18nService.translate("unlockAccount"),
        fillCredentialsFor: this.i18nService.translate("fillCredentialsFor"),
        partialUsername: this.i18nService.translate("partialUsername"),
        view: this.i18nService.translate("view"),
        noItemsToShow: this.i18nService.translate("noItemsToShow"),
        newItem: this.i18nService.translate("newItem"),
        addNewVaultItem: this.i18nService.translate("addNewVaultItem"),
      };
    }

    return this.overlayPageTranslations;
  }

  private redirectOverlayFocusOut(
    { direction }: OverlayBackgroundExtensionMessage,
    { sender }: chrome.runtime.Port
  ) {
    if (!direction) {
      return;
    }

    BrowserApi.tabSendMessageData(sender.tab, "redirectOverlayFocusOut", { direction });
  }

  private getNewVaultItemDetails({ sender }: chrome.runtime.Port) {
    BrowserApi.tabSendMessage(sender.tab, { command: "addNewVaultItemFromOverlay" });
  }

  private async addNewVaultItem(
    { login }: OverlayAddNewItemMessage,
    sender: chrome.runtime.MessageSender
  ) {
    if (!login) {
      return;
    }

    const uriView = new LoginUriView();
    uriView.uri = login.uri;

    const loginView = new LoginView();
    loginView.uris = [uriView];
    loginView.username = login.username || "";
    loginView.password = login.password || "";

    const cipherView = new CipherView();
    cipherView.name = (Utils.getHostname(login.uri) || login.hostname).replace(/^www\./, "");
    cipherView.folderId = null;
    cipherView.type = CipherType.Login;
    cipherView.login = loginView;

    await this.stateService.setAddEditCipherInfo({
      cipher: cipherView,
      collectionIds: cipherView.collectionIds,
    });

    await openAddEditVaultItemPopout(sender.tab.windowId, cipherView.id);
  }

  private setupExtensionMessageListeners() {
    chrome.runtime.onMessage.addListener(this.handleExtensionMessage);
    chrome.runtime.onConnect.addListener(this.handlePortOnConnect);
  }

  private handleExtensionMessage = (
    message: OverlayBackgroundExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) => {
    const handler: CallableFunction | undefined = this.extensionMessageHandlers[message?.command];
    if (!handler) {
      return false;
    }

    const messageResponse = handler({ message, sender });
    if (!messageResponse) {
      return false;
    }

    Promise.resolve(messageResponse).then((response) => sendResponse(response));
    return true;
  };

  private handlePortOnConnect = async (port: chrome.runtime.Port) => {
    const isOverlayListPort = port.name === AutofillOverlayPort.List;

    if (isOverlayListPort) {
      this.overlayListPort = port;
    } else {
      this.overlayButtonPort = port;
    }

    port.onMessage.addListener(this.handleOverlayElementPortMessage);
    port.postMessage({
      command: `initAutofillOverlay${isOverlayListPort ? "List" : "Button"}`,
      authStatus: await this.getAuthStatus(),
      styleSheetUrl: chrome.runtime.getURL(`overlay/${isOverlayListPort ? "list" : "button"}.css`),
      translations: this.getTranslations(),
      ciphers: isOverlayListPort ? this.getOverlayCipherData() : null,
    });
    this.updateOverlayPosition({
      overlayElement: isOverlayListPort
        ? AutofillOverlayElement.List
        : AutofillOverlayElement.Button,
    });
  };

  private handleOverlayElementPortMessage = (
    message: OverlayBackgroundExtensionMessage,
    port: chrome.runtime.Port
  ) => {
    const command = message?.command;
    let handler: CallableFunction | undefined;

    if (port.name === AutofillOverlayPort.Button) {
      handler = this.overlayButtonPortMessageHandlers[command];
    }

    if (port.name === AutofillOverlayPort.List) {
      handler = this.overlayListPortMessageHandlers[command];
    }

    if (!handler) {
      return;
    }

    handler({ message, port });
  };
}

export default OverlayBackground;