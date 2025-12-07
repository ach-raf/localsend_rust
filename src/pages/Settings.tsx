import { useState, useEffect } from 'react';
import { Container, Title, TextInput, NumberInput, Button, Stack, Paper } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { invoke } from '@tauri-apps/api/core';

interface AppConfig {
    alias: string;
    port: number;
}

export default function Settings() {
    const [config, setConfig] = useState<AppConfig>({ alias: '', port: 3030 });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            const settings = await invoke<AppConfig>('get_settings');
            setConfig(settings);
        } catch (e) {
            console.error(e);
            notifications.show({
                title: 'Error',
                message: 'Failed to load settings',
                color: 'red',
            });
        }
    };

    const handleSave = async () => {
        setLoading(true);
        try {
            await invoke('save_settings', { newConfig: config });
            notifications.show({
                title: 'Success',
                message: 'Settings saved successfully',
                color: 'green',
            });
        } catch (e) {
            console.error(e);
            notifications.show({
                title: 'Error',
                message: 'Failed to save settings: ' + String(e),
                color: 'red',
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Container size="sm">
            <Paper shadow="xs" p="xl" withBorder>
                <Title order={2} mb="lg">Settings</Title>
                <Stack>
                    <TextInput
                        label="Alias"
                        description="Your name visible to others"
                        value={config.alias}
                        onChange={(event) => setConfig({ ...config, alias: event.currentTarget.value })}
                    />
                    <NumberInput
                        label="Port"
                        description="Port to listen on (requires restart)"
                        value={config.port}
                        onChange={(val) => setConfig({ ...config, port: Number(val) })}
                        allowNegative={false}
                        min={1024}
                        max={65535}
                    />
                    <Button loading={loading} onClick={handleSave}>
                        Save Settings
                    </Button>
                </Stack>
            </Paper>
        </Container>
    );
}

