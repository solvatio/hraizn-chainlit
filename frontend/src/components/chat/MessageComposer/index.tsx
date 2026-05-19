import {
  MutableRefObject,
  useCallback,
  useRef,
  useState
} from 'react';
import { Plus } from 'lucide-react';
import { useRecoilState, useSetRecoilState } from 'recoil';
import { v4 as uuidv4 } from 'uuid';

import {
  FileSpec,
  IStep,
  useAuth,
  useChatData,
  useChatInteract
} from '@chainlit/react-client';

import { Settings } from '@/components/icons/Settings';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { useTranslation } from 'components/i18n/Translator';
import { useIsMobile } from '@/hooks/use-mobile';

import { chatSettingsOpenState } from '@/state/project';
import {
  IAttachment,
  attachmentsState,
  persistentCommandState
} from 'state/chat';

import { Attachments } from './Attachments';
import CommandButtons from './CommandButtons';
import CommandButton from './CommandPopoverButton';
import Input, { InputMethods } from './Input';
import McpButton from './Mcp';
import SubmitButton from './SubmitButton';
import UploadButton from './UploadButton';
import WebcamButton, {
  WebcamButtonMethods,
  WebcamToggleButton
} from './WebcamButton';
import VoiceButton from './VoiceButton';

interface Props {
  fileSpec: FileSpec;
  onFileUpload: (payload: File[]) => void;
  onFileUploadError: (error: string) => void;
  autoScrollRef: MutableRefObject<boolean>;
}

export default function MessageComposer({
  fileSpec,
  onFileUpload,
  onFileUploadError,
  autoScrollRef
}: Props) {
  const inputRef = useRef<InputMethods>(null);
  const webcamRef = useRef<WebcamButtonMethods>(null);
  const [value, setValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isWebcamBusy, setIsWebcamBusy] = useState(false);
  const [isWebcamEnabled, setIsWebcamEnabled] = useState(false);
  const [isMediaMenuOpen, setIsMediaMenuOpen] = useState(false);
  const [selectedCommand, setSelectedCommand] = useRecoilState(
    persistentCommandState
  );
  const setChatSettingsOpen = useSetRecoilState(chatSettingsOpenState);
  const [attachments, setAttachments] = useRecoilState(attachmentsState);
  const { t } = useTranslation();

  const { user } = useAuth();
  const { sendMessage, replyMessage } = useChatInteract();
  const { askUser, chatSettingsInputs, disabled: _disabled } = useChatData();

  const disabled =
    _disabled ||
    isSubmitting ||
    isWebcamBusy ||
    !!attachments.find((a) => !a.uploaded);

  const isMobile = useIsMobile();

  const onPaste = useCallback(
    (event: ClipboardEvent) => {
      if (event.clipboardData && event.clipboardData.items) {
        const items = Array.from(event.clipboardData.items);

        // If no text data, check for files (e.g., images)
        items.forEach((item) => {
          if (item.kind === 'file') {
            const file = item.getAsFile();
            if (file) {
              onFileUpload([file]);
            }
          }
        });
      }
    },
    [onFileUpload]
  );

  const onSubmit = useCallback(
    async (
      msg: string,
      attachments?: IAttachment[],
      selectedCommand?: string
    ) => {
      const message: IStep = {
        threadId: '',
        command: selectedCommand,
        id: uuidv4(),
        name: user?.identifier || 'User',
        type: 'user_message',
        output: msg,
        createdAt: new Date().toISOString(),
        metadata: { location: window.location.href }
      };

      const fileReferences = attachments
        ?.filter((a) => !!a.serverId)
        .map((a) => ({ id: a.serverId! }));

      if (autoScrollRef) {
        autoScrollRef.current = true;
      }
      sendMessage(message, fileReferences);
    },
    [user, sendMessage, autoScrollRef]
  );

  const onReply = useCallback(
    async (msg: string) => {
      const message: IStep = {
        threadId: '',
        id: uuidv4(),
        name: user?.identifier || 'User',
        type: 'user_message',
        output: msg,
        createdAt: new Date().toISOString(),
        metadata: { location: window.location.href }
      };

      replyMessage(message);
      if (autoScrollRef) {
        autoScrollRef.current = true;
      }
    },
    [user, replyMessage, autoScrollRef]
  );

  const submit = useCallback(async () => {
    if (
      disabled ||
      (
        value.trim() === '' &&
        attachments.length === 0 &&
        !selectedCommand &&
        !isWebcamEnabled
      )
    ) {
      return;
    }

    setIsSubmitting(true);

    try {
      if (askUser) {
        onReply(value);
      } else {
        const webcamAttachment = await webcamRef.current?.captureAndUpload();
        const nextAttachments = webcamAttachment
          ? attachments.concat(webcamAttachment)
          : attachments;

        webcamRef.current?.disableStream();
        await onSubmit(value, nextAttachments, selectedCommand?.id);
      }

      setAttachments([]);
      setValue('');
      inputRef.current?.reset();
    } catch {
      return;
    } finally {
      setIsSubmitting(false);
    }
  }, [
    value,
    disabled,
    askUser,
    attachments,
    selectedCommand,
    isWebcamEnabled,
    setAttachments,
    onSubmit,
    onReply
  ]);

return (
  <div id="message-composer" className="w-full">
    {/* WRAPPER: Input + Buttons im selben Pill-Container */}
    <div className="bg-accent dark:bg-card rounded-3xl px-4 flex flex-col gap-2">
      {/* Attachments oben */}
      {attachments.length > 0 && (
        <div className="pt-2">
          <Attachments />
        </div>
      )}

      {/* Input + Buttons in einer Reihe */}
      <div className="flex items-start gap-2">
        <div className="flex-1 py-1">
          <Input
            ref={inputRef}
            id="chat-input"
            autoFocus={!isMobile}
            selectedCommand={selectedCommand}
            setSelectedCommand={setSelectedCommand}
            onChange={setValue}
            onPaste={onPaste}
            onEnter={submit}
            placeholder={t("chat.input.placeholder")}
            className="min-h-10 py-2 leading-normal"
          />
        </div>

        <div className="sticky top-0 h-12 flex items-center gap-1">
          <WebcamButton
            ref={webcamRef}
            disabled={disabled}
            hideTrigger
            onError={onFileUploadError}
            onBusyChange={setIsWebcamBusy}
            onEnabledChange={setIsWebcamEnabled}
          />
          <DropdownMenu open={isMediaMenuOpen} onOpenChange={setIsMediaMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                disabled={disabled}
                className="rounded-full hover:bg-foreground/10 hover:text-current"
                variant="ghost"
                size="icon"
                aria-label="Open media actions"
              >
                <Plus
                  className={`!size-5 transition-transform ${
                    isMediaMenuOpen ? 'rotate-45' : ''
                  }`}
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              className="mb-2 min-w-0 rounded-2xl border-0 bg-accent p-1.5 shadow-sm dark:bg-card"
            >
              <div className="flex flex-col gap-1">
                <WebcamToggleButton
                  disabled={disabled}
                  isBusy={isWebcamBusy}
                  isEnabled={isWebcamEnabled}
                  onClick={() => {
                    webcamRef.current?.toggleStream();
                    setIsMediaMenuOpen(false);
                  }}
                />
                <VoiceButton disabled={disabled} />
                <UploadButton
                  disabled={disabled}
                  fileSpec={fileSpec}
                  onFileUploadError={onFileUploadError}
                  onFileUpload={onFileUpload}
                />
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          {chatSettingsInputs.length > 0 && (
            <Button
              id="chat-settings-open-modal"
              disabled={disabled}
              onClick={() => setChatSettingsOpen(true)}
              className="hover:bg-muted rounded-full"
              variant="ghost"
              size="icon"
            >
              <Settings className="!size-6" />
            </Button>
          )}
          <McpButton disabled={disabled} />
          <CommandButton
            disabled={disabled}
            selectedCommandId={selectedCommand?.id}
            onCommandSelect={setSelectedCommand}
          />
          <CommandButtons
            disabled={disabled}
            selectedCommandId={selectedCommand?.id}
            onCommandSelect={setSelectedCommand}
          />
          <SubmitButton
            onSubmit={submit}
            disabled={
              disabled ||
              (
                !value.trim() &&
                !selectedCommand &&
                attachments.length === 0 &&
                !isWebcamEnabled
              )
            }
          />
        </div>
      </div>
    </div>
  </div>
);
}
