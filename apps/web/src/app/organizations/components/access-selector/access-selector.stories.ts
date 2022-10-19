import { FormBuilder, FormsModule, ReactiveFormsModule } from "@angular/forms";
import { action } from "@storybook/addon-actions";
import { Meta, moduleMetadata, Story } from "@storybook/angular";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { OrganizationUserStatusType } from "@bitwarden/common/enums/organizationUserStatusType";
import { OrganizationUserType } from "@bitwarden/common/enums/organizationUserType";
import {
  AvatarModule,
  BadgeModule,
  ButtonModule,
  FormFieldModule,
  IconButtonModule,
  TableModule,
  TabsModule,
} from "@bitwarden/components";

import { PreloadedEnglishI18nModule } from "../../../tests/preloaded-english-i18n.module";

import { AccessSelectorComponent } from "./access-selector.component";
import { AccessItemType, AccessItemView, CollectionPermission } from "./access-selector.models";
import { UserTypePipe } from "./user-type.pipe";

export default {
  title: "Web/Organizations/Access Selector",
  decorators: [
    moduleMetadata({
      declarations: [AccessSelectorComponent, UserTypePipe],
      imports: [
        ButtonModule,
        FormFieldModule,
        AvatarModule,
        BadgeModule,
        ReactiveFormsModule,
        FormsModule,
        TabsModule,
        TableModule,
        PreloadedEnglishI18nModule,
        JslibModule,
        IconButtonModule,
      ],
      providers: [],
    }),
  ],
  parameters: {},
  argTypes: {
    formObj: { table: { disable: true } },
  },
} as Meta;

const actionsData = {
  onValueChanged: action("onValueChanged"),
  onSubmit: action("onSubmit"),
};

/**
 * Factory to help build semi-realistic looking items
 * @param n - The number of items to build
 * @param type - Which type to build
 */
const itemsFactory = (n: number, type: AccessItemType) => {
  return [...Array(n)].map((_: unknown, id: number) => {
    const item: AccessItemView = {
      id: id.toString(),
      type: type,
    } as AccessItemView;

    switch (item.type) {
      case AccessItemType.COLLECTION:
        item.labelName = item.listName = `Collection ${id}`;
        item.id = item.id + "c";
        item.parentGrouping = "Collection Parent Group " + ((id % 2) + 1);
        break;
      case AccessItemType.GROUP:
        item.labelName = item.listName = `Group ${id}`;
        item.id = item.id + "g";
        break;
      case AccessItemType.MEMBER:
        item.id = item.id + "m";
        item.email = `member${id}@email.com`;
        item.status = id % 3 == 0 ? 0 : 2;
        item.labelName = item.status == 2 ? `Member ${id}` : item.email;
        item.listName = item.status == 2 ? `${item.labelName} (${item.email})` : item.email;
        item.role = id % 5;
        break;
    }

    return item;
  });
};

const sampleMembers = itemsFactory(10, AccessItemType.MEMBER);
const sampleGroups = itemsFactory(6, AccessItemType.GROUP);

const StandaloneAccessSelectorTemplate: Story<AccessSelectorComponent> = (
  args: AccessSelectorComponent
) => ({
  props: {
    items: [],
    valueChanged: actionsData.onValueChanged,
    initialValue: [],
    ...args,
  },
  template: `
            <bit-access-selector
              (ngModelChange)="valueChanged($event)"
              [ngModel]="initialValue"
              [items]="items"
              [disabled]="disabled"
              [columnHeader]="columnHeader"
              [showGroupColumn]="showGroupColumn"
              [selectorLabelText]="selectorLabelText"
              [selectorHelpText]="selectorHelpText"
              [emptySelectionText]="emptySelectionText"
              [permissionMode]="permissionMode"
              [showMemberRoles]="showMemberRoles"
            ></bit-access-selector>
`,
});

const memberCollectionAccessItems = itemsFactory(3, AccessItemType.COLLECTION).concat([
  {
    id: "c1-group1",
    type: AccessItemType.COLLECTION,
    labelName: "Collection 1",
    listName: "Collection 1",
    viaGroupName: "Group 1",
    readonlyPermission: CollectionPermission.VIEW,
    readonly: true,
  },
  {
    id: "c1-group2",
    type: AccessItemType.COLLECTION,
    labelName: "Collection 1",
    listName: "Collection 1",
    viaGroupName: "Group 2",
    readonlyPermission: CollectionPermission.VIEW_EXCEPT_PASSWORDS,
    readonly: true,
  },
]);

export const MemberCollectionAccess = StandaloneAccessSelectorTemplate.bind({});
MemberCollectionAccess.args = {
  permissionMode: "edit",
  showMemberRoles: false,
  showGroupColumn: true,
  columnHeader: "Collection",
  selectorLabelText: "Select Collections",
  selectorHelpText: "Some helper text describing what this does",
  emptySelectionText: "No collections added",
  disabled: false,
  initialValue: [],
  items: memberCollectionAccessItems,
};
MemberCollectionAccess.story = {
  parameters: {
    docs: {
      storyDescription: `
        Example of an access selector for modifying the collections a member has access to.
        Includes examples of a readonly group and member that cannot be edited.
      `,
    },
  },
};

export const MemberGroupAccess = StandaloneAccessSelectorTemplate.bind({});
MemberGroupAccess.args = {
  permissionMode: "readonly",
  showMemberRoles: false,
  columnHeader: "Groups",
  selectorLabelText: "Select Groups",
  selectorHelpText: "Some helper text describing what this does",
  emptySelectionText: "No groups added",
  disabled: false,
  initialValue: [{ id: "3g" }, { id: "0g" }],
  items: itemsFactory(4, AccessItemType.GROUP).concat([
    {
      id: "admin",
      type: AccessItemType.GROUP,
      listName: "Admin Group",
      labelName: "Admin Group",
      accessAllItems: true,
    },
  ]),
};
MemberGroupAccess.story = {
  parameters: {
    docs: {
      storyDescription: `
        Example of an access selector for selecting which groups an individual member belongs too.
      `,
    },
  },
};

export const GroupMembersAccess = StandaloneAccessSelectorTemplate.bind({});
GroupMembersAccess.args = {
  permissionMode: "hidden",
  showMemberRoles: true,
  columnHeader: "Members",
  selectorLabelText: "Select Members",
  selectorHelpText: "Some helper text describing what this does",
  emptySelectionText: "No members added",
  disabled: false,
  initialValue: [{ id: "2m" }, { id: "0m" }],
  items: sampleMembers,
};
GroupMembersAccess.story = {
  parameters: {
    docs: {
      storyDescription: `
        Example of an access selector for selecting which members belong to an specific group.
      `,
    },
  },
};

export const CollectionAccess = StandaloneAccessSelectorTemplate.bind({});
CollectionAccess.args = {
  permissionMode: "edit",
  showMemberRoles: false,
  columnHeader: "Groups/Members",
  selectorLabelText: "Select groups and members",
  selectorHelpText:
    "Permissions set for a member will replace permissions set by that member's group",
  emptySelectionText: "No members or groups added",
  disabled: false,
  initialValue: [
    { id: "3g", permission: CollectionPermission.EDIT_EXCEPT_PASSWORDS },
    { id: "0m", permission: CollectionPermission.VIEW },
  ],
  items: sampleGroups.concat(sampleMembers).concat([
    {
      id: "admin-group",
      type: AccessItemType.GROUP,
      listName: "Admin Group",
      labelName: "Admin Group",
      accessAllItems: true,
      readonly: true,
    },
    {
      id: "admin-member",
      type: AccessItemType.MEMBER,
      listName: "Admin Member (admin@email.com)",
      labelName: "Admin Member",
      status: OrganizationUserStatusType.Confirmed,
      role: OrganizationUserType.Admin,
      email: "admin@email.com",
      accessAllItems: true,
      readonly: true,
    },
  ]),
};
GroupMembersAccess.story = {
  parameters: {
    docs: {
      storyDescription: `
        Example of an access selector for selecting which members/groups have access to a specific collection.
      `,
    },
  },
};

const fb = new FormBuilder();

const ReactiveFormAccessSelectorTemplate: Story<AccessSelectorComponent> = (
  args: AccessSelectorComponent
) => ({
  props: {
    items: [],
    onSubmit: actionsData.onSubmit,
    ...args,
  },
  template: `
    <form [formGroup]="formObj" (ngSubmit)="onSubmit(formObj.controls.formItems.value)">
            <bit-access-selector
              formControlName="formItems"
              [items]="items"
              [columnHeader]="columnHeader"
              [selectorLabelText]="selectorLabelText"
              [selectorHelpText]="selectorHelpText"
              [emptySelectionText]="emptySelectionText"
              [permissionMode]="permissionMode"
              [showMemberRoles]="showMemberRoles"
            ></bit-access-selector>
            <button type="submit" bitButton buttonType="primary" class="tw-mt-5">Submit</button>
    </form>
`,
});

export const ReactiveForm = ReactiveFormAccessSelectorTemplate.bind({});
ReactiveForm.args = {
  formObj: fb.group({ formItems: [[{ id: "1g" }]] }),
  permissionMode: "edit",
  showMemberRoles: false,
  columnHeader: "Groups/Members",
  selectorLabelText: "Select groups and members",
  selectorHelpText:
    "Permissions set for a member will replace permissions set by that member's group",
  emptySelectionText: "No members or groups added",
  items: sampleGroups.concat(sampleMembers),
};
