package task

import (
	"context"
	"strings"
	"time"

	"github.com/zkk520/uni-router/internal/helper"
	"github.com/zkk520/uni-router/internal/model"
	"github.com/zkk520/uni-router/internal/op"
	"github.com/zkk520/uni-router/internal/utils/diff"
	"github.com/zkk520/uni-router/internal/utils/log"
	"github.com/zkk520/uni-router/internal/utils/xstrings"
)

var lastSyncModelsTime = time.Now()

// SyncModelsTask 同步模型任务
func SyncModelsTask() {
	log.Debugf("sync models task started")
	startTime := time.Now()
	defer func() {
		log.Debugf("sync models task finished, sync time: %s", time.Since(startTime))
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	channels, err := op.ChannelList(ctx)
	if err != nil {
		log.Errorf("failed to list channels: %v", err)
		return
	}
	totalNewModels := make([]string, 0, 128)
	seenTotalNewModels := make(map[string]struct{}, 128)
	for _, channel := range channels {
		if !channel.AutoSync {
			continue
		}
		fetchResult := helper.FetchModelsByKey(ctx, channel)
		if len(fetchResult.Results) == 0 {
			log.Warnf("failed to fetch models for channel %s: no enabled api key available", channel.Name)
			continue
		}
		keyUpdates := make([]model.ChannelKeyUpdateRequest, 0, len(fetchResult.Results))
		for _, result := range fetchResult.Results {
			syncErr := result.Error
			update := model.ChannelKeyUpdateRequest{
				ID:              result.KeyID,
				ModelsSyncedAt:  &result.ModelsSyncedAt,
				ModelsSyncError: &syncErr,
			}
			if result.Success {
				models := result.Models
				update.Models = &models
			}
			keyUpdates = append(keyUpdates, update)
			if !result.Success {
				log.Warnf("failed to fetch models for channel %s key %s: %s", channel.Name, result.MaskedKey, result.Error)
			}
		}
		oldModels := xstrings.SplitTrimCompact(",", channel.Model)
		newModels := effectiveSyncedModels(channel, fetchResult)
		for _, m := range newModels {
			m = strings.TrimSpace(m)
			if m == "" {
				continue
			}
			m = strings.ToLower(m)
			if _, ok := seenTotalNewModels[m]; ok {
				continue
			}
			seenTotalNewModels[m] = struct{}{}
			totalNewModels = append(totalNewModels, m)
		}
		deletedModels, addedModels := diff.Diff(oldModels, newModels)
		fetchModelStr := strings.Join(newModels, ",")
		if _, err := op.ChannelUpdate(&model.ChannelUpdateRequest{
			ID:           channel.ID,
			Model:        &fetchModelStr,
			KeysToUpdate: keyUpdates,
		}, ctx); err != nil {
			log.Errorf("failed to update channel %s: %v", channel.Name, err)
			continue
		}
		if len(deletedModels) > 0 {
			log.Infof("deleted channel %s models: %v", channel.Name, deletedModels)
		}
		if len(addedModels) > 0 {
			log.Infof("added channel %s models: %v", channel.Name, addedModels)
		}
	}
	llmPrice, err := op.LLMList(ctx)
	if err != nil {
		log.Errorf("failed to list models price: %v", err)
		return
	}
	llmPriceNames := make([]string, 0, len(llmPrice))
	for _, price := range llmPrice {
		llmPriceNames = append(llmPriceNames, price.Name)
	}

	deletedNorm, addedNorm := diff.Diff(llmPriceNames, totalNewModels)
	if len(deletedNorm) > 0 {
		if err := helper.LLMPriceDeleteFromDBWithNoPrice(deletedNorm, ctx); err != nil {
			log.Errorf("failed to batch delete models price: %v", err)
		}
	}
	if len(addedNorm) > 0 {
		if err := helper.LLMPriceAddToDB(addedNorm, ctx); err != nil {
			log.Errorf("failed to add models price: %v", err)
		}
	}
	lastSyncModelsTime = time.Now()
}

func GetLastSyncModelsTime() time.Time {
	return lastSyncModelsTime
}

func effectiveSyncedModels(channel model.Channel, fetchResult model.ChannelFetchModelsResponse) []string {
	models := make([]string, 0, len(fetchResult.Models))
	seen := map[string]struct{}{}
	add := func(items []string) {
		for _, m := range items {
			m = strings.TrimSpace(m)
			if m == "" {
				continue
			}
			if _, ok := seen[m]; ok {
				continue
			}
			seen[m] = struct{}{}
			models = append(models, m)
		}
	}
	for _, result := range fetchResult.Results {
		if result.Success {
			add(result.Models)
			continue
		}
		for _, key := range channel.Keys {
			if key.ID == result.KeyID {
				add(key.Models)
				break
			}
		}
	}
	return models
}
