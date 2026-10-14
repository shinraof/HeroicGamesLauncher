import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PathSelectionBox,
  TextInputField,
  ToggleSwitch
} from 'frontend/components/UI'
import useSetting from 'frontend/hooks/useSetting'
import SettingsContext from '../SettingsContext'

export default function AdditionalApplication() {
  const { t } = useTranslation()
  const { isDefault, gameInfo } = useContext(SettingsContext)
  const [application, setApplication] = useSetting('additionalApplication', {
    enabled: false,
    path: '',
    delay: 0,
    runFirst: false
  })

  if (isDefault) return null

  return (
    <div className="additionalApplication">
      <h4>
        {t('setting.additionalApplication.title', 'Additional application')}
      </h4>
      <p>
        {t(
          'setting.additionalApplication.description',
          'Automatically launch another application with the game, using the same Wine/Proton version and prefix.'
        )}
      </p>
      <ToggleSwitch
        htmlId="additional-application-enabled"
        title={t(
          'setting.additionalApplication.enable',
          'Enable additional application'
        )}
        value={application.enabled}
        handleChange={() =>
          setApplication({ ...application, enabled: !application.enabled })
        }
      />
      <fieldset disabled={!application.enabled}>
        <PathSelectionBox
          htmlId="additional-application-path"
          type="file"
          path={application.path}
          label={t('setting.additionalApplication.path', 'Application path')}
          pathDialogTitle={t(
            'setting.additionalApplication.select',
            'Select an additional application'
          )}
          pathDialogDefaultPath={gameInfo?.install.install_path}
          onPathChange={(path) => setApplication({ ...application, path })}
        />
        <TextInputField
          htmlId="additional-application-delay"
          type="number"
          min={0}
          max={60}
          step={1}
          label={t(
            'setting.additionalApplication.delay',
            'Delay between applications (seconds)'
          )}
          value={String(application.delay)}
          onChange={(value) =>
            setApplication({
              ...application,
              delay: Math.min(60, Math.max(0, Math.trunc(Number(value) || 0)))
            })
          }
        />
        <ToggleSwitch
          htmlId="additional-application-first"
          title={t(
            'setting.additionalApplication.first',
            'Run the additional application first'
          )}
          value={application.runFirst}
          handleChange={() =>
            setApplication({ ...application, runFirst: !application.runFirst })
          }
        />
      </fieldset>
    </div>
  )
}
