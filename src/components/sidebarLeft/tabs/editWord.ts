/*
 * https://github.com/morethanwords/tweb
 * Copyright (C) 2019-2021 Eduard Kuzmenko
 * https://github.com/morethanwords/tweb/blob/master/LICENSE
 */

import type {MyDialogFilter} from '../../../lib/storages/filters';
import appDialogsManager from '../../../lib/appManagers/appDialogsManager';
import lottieLoader, {LottieLoader} from '../../../lib/rlottie/lottieLoader';
import {SliderSuperTab} from '../../slider';
import {toast, toastNew} from '../../toast';
import InputField from '../../inputField';
import ButtonIcon from '../../buttonIcon';
import ButtonMenuToggle from '../../buttonMenuToggle';
import {ButtonMenuItemOptions} from '../../buttonMenu';
import Button from '../../button';
import AppIncludedChatsTab from './includedChats';
import {i18n, LangPackKey} from '../../../lib/langPack';
import RLottiePlayer from '../../../lib/rlottie/rlottiePlayer';
import copy from '../../../helpers/object/copy';
import deepEqual from '../../../helpers/object/deepEqual';
import wrapDraftText from '../../../lib/richTextProcessor/wrapDraftText';
import filterAsync from '../../../helpers/array/filterAsync';
import {attachClickEvent} from '../../../helpers/dom/clickEvent';
import SettingSection from '../../settingSection';
import {DialogFilter, ExportedChatlistInvite} from '../../../layer';
import rootScope from '../../../lib/rootScope';
import confirmationPopup from '../../confirmationPopup';
import Row from '../../row';
import createContextMenu from '../../../helpers/dom/createContextMenu';
import findUpClassName from '../../../helpers/dom/findUpClassName';
import {copyTextToClipboard} from '../../../helpers/clipboard';
import wrapEmojiText from '../../../lib/richTextProcessor/wrapEmojiText';
import AppSharedFolderTab from './sharedFolder';
import showLimitPopup from '../../popups/limit';
import toggleDisability from '../../../helpers/dom/toggleDisability';
import PopupSharedFolderInvite from '../../popups/sharedFolderInvite';
import PopupElement from '../../popups';
import {TGICO_CLASS} from '../../../helpers/tgico';
import Icon from '../../icon';

const MAX_FOLDER_NAME_LENGTH = 12;

type EditWordButton = {
  icon: Icon,
  name?: keyof DialogFilter.dialogFilter['pFlags'],
  withRipple?: true,
  text: LangPackKey
};

export default class AppEditWordTab extends SliderSuperTab {
  private caption: HTMLElement;
  private stickerContainer: HTMLElement;

  private confirmBtn: HTMLElement;
  private menuBtn: HTMLElement;
  private nameInputField: InputField;
  private ExplanationInputField: InputField;

  private flags: {[k in 'contacts' | 'non_contacts' | 'groups' | 'broadcasts' | 'bots' | 'exclude_muted' | 'exclude_archived' | 'exclude_read']: HTMLElement} = {} as any;

  private animation: RLottiePlayer;
  private filter: MyDialogFilter;
  private originalFilter: MyDialogFilter;

  private type: 'edit' | 'create';
  private loadAnimationPromise: ReturnType<LottieLoader['waitForFirstFrame']>;

  private tempId: number;

  private showMoreClicked: {[key in 'includePeerIds' | 'excludePeerIds']?: boolean}

  public static getInitArgs() {
    return {
      animationData: lottieLoader.loadAnimationFromURLManually('Folders_2')
    };
  }

  // okay
  public static async deleteFolder(filterId: number) {
    const filter = await rootScope.managers.filtersStorage.getFilter(filterId);
    if(filter?._ === 'dialogFilterChatlist' && !filter.pFlags.has_my_invites) {
      PopupElement.createPopup(PopupSharedFolderInvite, {
        filter,
        deleting: true
      });

      return;
    }

    await confirmationPopup({
      titleLangKey: 'WordList.Reserved.Remove.Header',
      descriptionLangKey: 'WordList.Reserved.Confirm.Remove.Text',
      button: {
        langKey: 'Delete',
        isDanger: true
      }
    });

    return rootScope.managers.filtersStorage.updateDialogFilter(
      {
        _: 'dialogFilter',
        id: filterId
      } as DialogFilter.dialogFilter,
      true
    );
  }

  public init(p: ReturnType<typeof AppEditWordTab['getInitArgs']> = AppEditWordTab.getInitArgs()) {
    this.container.classList.add('edit-folder-container');
    this.caption = document.createElement('div');
    this.caption.classList.add('caption');
    this.stickerContainer = document.createElement('div');
    this.stickerContainer.classList.add('sticker-container');

    this.tempId = 0;
    this.showMoreClicked = {};

    this.confirmBtn = ButtonIcon('check btn-confirm hide blue');
    let deleting = false;
    const deleteFolderButton: ButtonMenuItemOptions = {
      icon: 'delete',
      className: 'danger',
      text: 'FilterMenuDelete',
      onClick: () => {
        if(deleting) {
          return;
        }

        AppEditWordTab.deleteFolder(this.filter.id).then(() => {
          this.close();
        }).finally(() => {
          deleting = false;
        });
      }
    };
    this.menuBtn = ButtonMenuToggle({
      listenerSetter: this.listenerSetter,
      direction: 'bottom-left',
      buttons: [deleteFolderButton]
    });
    this.menuBtn.classList.add('hide');

    this.header.append(this.confirmBtn, this.menuBtn);

    const inputSection = new SettingSection({});

    const inputWrapper = document.createElement('div');
    inputWrapper.classList.add('input-wrapper');

    this.nameInputField = new InputField({
      label: 'WordNameHint',
      maxLength: MAX_FOLDER_NAME_LENGTH
    });
    this.ExplanationInputField = new InputField({
      label: 'WordExplanationHint',
      maxLength: MAX_FOLDER_NAME_LENGTH
    });

    inputWrapper.append(this.nameInputField.container);
    inputWrapper.append(this.ExplanationInputField.container);
    inputSection.content.append(inputWrapper);

    const generateList = (
      className: string,
      h2Text: LangPackKey,
      buttons: EditWordButton[],
      to: any,
      caption?: LangPackKey
    ) => {
      const section = new SettingSection({
        name: h2Text,
        caption,
        noDelimiter: true
      });

      section.container.classList.add('folder-list', className);

      const categories = section.generateContentElement();
      categories.classList.add('folder-categories');

      buttons.forEach((o, idx) => {
        const button = Button('folder-category-button btn btn-primary btn-transparent' + (idx === 0 ? ' primary' : ' disable-hover'), {
          icon: o.icon,
          text: o.text,
          noRipple: o.withRipple ? undefined : true
        });

        if(o.name) {
          to[o.name] = button;
        }

        categories.append(button);
      });

      return section;
    };

    this.scrollable.append(
      this.stickerContainer,
      this.caption,
      inputSection.container
    );

    // attachClickEvent(includedFlagsContainer.querySelector('.btn') as HTMLElement, () => {
    //   this.slider.createTab(AppIncludedChatsTab).open(this.filter, 'included', this);
    // }, {listenerSetter: this.listenerSetter});

    // attachClickEvent(excludedFlagsContainer.querySelector('.btn') as HTMLElement, () => {
    //   this.slider.createTab(AppIncludedChatsTab).open(this.filter, 'excluded', this);
    // }, {listenerSetter: this.listenerSetter});

    const confirmEditing = (closeAfter?: boolean) => {
      if(this.nameInputField.input.classList.contains('error')) {
        return;
      }

      if(!this.nameInputField.value.trim()) {
        this.nameInputField.input.classList.add('error');
        return;
      }


      this.confirmBtn.setAttribute('disabled', 'true');

      let promise: Promise<DialogFilter>;
      if(!this.filter.id) {
        promise = this.managers.filtersStorage.createDialogFilter(this.filter);
      } else {
        if(closeAfter) {
          postponeFilterUpdate = true;
        }

        promise = this.managers.filtersStorage.updateDialogFilter(this.filter);
      }

      return promise.then((dialogFilter) => {
        if(closeAfter) {
          this.close();
        }

        return dialogFilter;
      }).catch((err: ApiError) => {
        postponeFilterUpdate = false;
        if(postponedFilterUpdate) {
          this.updateFilter(postponedFilterUpdate);
          postponedFilterUpdate = undefined;
        }

        if(err.type === 'DIALOG_FILTERS_TOO_MUCH') {
          showLimitPopup('folders');
        } else {
          console.error('updateDialogFilter error:', err);
        }

        throw err;
      }).finally(() => {
        this.confirmBtn.removeAttribute('disabled');
      });
    };

    attachClickEvent(this.confirmBtn, () => {
      confirmEditing(true);
    }, {listenerSetter: this.listenerSetter});

    let postponedFilterUpdate: DialogFilter.dialogFilterChatlist | DialogFilter.dialogFilter;
    let postponeFilterUpdate = false;

    this.listenerSetter.add(rootScope)('filter_update', (filter) => {
      if(this.filter.id === filter.id) {
        if(postponeFilterUpdate) {
          postponedFilterUpdate = filter;
        } else {
          this.updateFilter(filter);
        }
      }
    });

    this.listenerSetter.add(this.nameInputField.input)('input', () => {
      this.filter.title = this.nameInputField.value;
      this.editCheckForChange();
    });

    const reloadMissingPromises: Promise<any>[] = this.type === 'edit' ? [
      this.managers.filtersStorage.reloadMissingPeerIds(this.filter.id, 'pinned_peers'),
      this.managers.filtersStorage.reloadMissingPeerIds(this.filter.id, 'include_peers'),
      this.managers.filtersStorage.reloadMissingPeerIds(this.filter.id, 'exclude_peers')
    ] : [];

    return Promise.all([

      this.loadAnimationPromise = p.animationData.then(async(cb) => {
        const player = await cb({
          container: this.stickerContainer,
          loop: false,
          autoplay: false,
          width: 86,
          height: 86
        });

        this.animation = player;

        return lottieLoader.waitForFirstFrame(player);
      }),

      ...reloadMissingPromises
    ]).then(([chatlistInvitesLimit, chatlistInvitesPremiumLimit]) => {
      if(this.type === 'edit') {
        this.setFilter(this.originalFilter, true);
        this.onEditOpen();
      } else {
        this.setInitFilter();
        this.onCreateOpen();
      }
    });
  }

  onOpenAfterTimeout() {
    this.loadAnimationPromise.then(() => {
      this.animation.autoplay = true;
      this.animation.play();
    });
  }

  private onCreateOpen() {
    // this.caption.style.display = '';
    this.setTitle('ReservedNew');
    this.menuBtn.classList.add('hide');
    this.confirmBtn.classList.remove('hide');

    for(const flag in this.flags) {
      // @ts-ignore
      this.flags[flag].style.display = 'none';
    }
  }

  private onEditOpen() {
    const tempId = ++this.tempId;
    this.setTitle(this.type === 'create' ? 'ReservedNew' : 'ReservedEdit');

    if(this.type === 'edit') {
      this.menuBtn.classList.remove('hide');
      this.confirmBtn.classList.add('hide');
    }

    const filter = this.filter;
    this.nameInputField.value = wrapDraftText(filter.title);

    const pFlags = (filter as DialogFilter.dialogFilter).pFlags;
    for(const flag in this.flags) {
      const good = !!pFlags?.[flag as keyof AppEditWordTab['flags']];
      this.flags[flag as keyof AppEditWordTab['flags']].style.display = good ? '' : 'none';
    }
  }

  editCheckForChange() {
    if(this.type === 'edit') {
      const changed = !deepEqual(
        {...this.originalFilter, updatedTime: 0, localId: 0},
        {...this.filter, updatedTime: 0, localId: 0}
      );
      this.confirmBtn.classList.toggle('hide', !changed);
      this.menuBtn.classList.toggle('hide', changed);
    }
  };

  setFilter(filter: MyDialogFilter, firstTime: boolean) {
    if(firstTime) {
      this.originalFilter = filter;
      this.filter = copy(filter);
    } else {
      this.filter = filter;
      this.onEditOpen();
      this.editCheckForChange();
    }
  }

  public setInitFilter(filter?: MyDialogFilter) {
    if(filter === undefined) {
      this.setFilter({
        _: 'dialogFilter',
        id: 0,
        title: '',
        pFlags: {},
        pinned_peers: [],
        include_peers: [],
        exclude_peers: [],
        pinnedPeerIds: [],
        includePeerIds: [],
        excludePeerIds: []
      }, true);
      this.type = 'create';
    } else {
      this.setFilter(filter, true);
      this.type = 'edit';
    }
  }

  private updateFilter(filter: DialogFilter.dialogFilterChatlist | DialogFilter.dialogFilter) {
    this.setFilter(filter, false);
  }
}
