import { Injectable, Logger } from '@nestjs/common';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac } from 'node:crypto';
import { CreateSymbolDto } from './dto/create-symbol.dto';
import { Symbol } from './entities/symbol.entity';
import { History } from './entities/history.entity';
import { Side } from './enums/side.num';

@Injectable()
export class SymbolsService {
    private readonly logger = new Logger(SymbolsService.name);

    constructor(
        private readonly schedulerRegistry: SchedulerRegistry,

        @InjectRepository(Symbol)
        private symbolRepository: Repository<Symbol>,

        @InjectRepository(History)
        private historyRepository: Repository<History>
    ) {
        this.restartTimeouts();
    }

    async createSymbol(createSymbolDto: CreateSymbolDto) {
        const { name, listingDate } = createSymbolDto;

        const symbol = await this.symbolRepository.save({
            name: name.toUpperCase() + "USDT",
            listingDate: new Date(listingDate + "+4:00")
        });

        const timeoutMS = symbol.listingDate.getTime() - new Date().getTime() - 1000;

        if (timeoutMS > 0)
            this.addTimeout(symbol.name, timeoutMS, (name) => this.setStartPrice(name));

        return symbol;
    }

    private async setStartPrice(name: string) {
        const { MEXC_HOST } = process.env;
        const symbol = await this.symbolRepository.findOneBy({ name });

        if (symbol.isListed)
            return { success: false }

        let price = 0;

        while (price == 0) {
            const response = await fetch(`${MEXC_HOST}/ticker/price?symbol=${name}`);
            const data = await response.json();

            price = data.price;

            if (price == 0)
                await this.delay(100);
        }

        await this.createOrder(name, Side.Buy);
        this.addTimeout(symbol.name, 1000 * 60 * 60, (name) => this.createOrder(name, Side.Sell));

        symbol.isListed = true;
        symbol.priceOnStart = price;

        this.addTimeout(symbol.name, 1000 * 60, (name) => this.setMinutePrice(name));

        await this.symbolRepository.save(symbol);

        return { success: true };
    }

    private async setMinutePrice(name: string) {
        const { MEXC_HOST } = process.env;
        const symbol = await this.symbolRepository.findOneBy({ name });

        const response = await fetch(`${MEXC_HOST}/ticker/price?symbol=${name}`);
        const data = await response.json();

        symbol.priceOnMinute = data.price;

        await this.symbolRepository.save(symbol);

        return { success: true };
    }

    async restartTimeouts() {
        const symbols = await this.symbolRepository
            .createQueryBuilder('symbol')
            .where('symbol.isListed = false OR (symbol.isListed = true AND symbol.priceOnMinute IS NULL)')
            .getMany();

        if (symbols.length > 0) {
            for (let symbol of symbols) {
                const timeoutMS = symbol.listingDate.getTime() - new Date().getTime() - 1000;

                if (timeoutMS > 0)
                    this.addTimeout(symbol.name, timeoutMS, (name) => !symbol.isListed ? this.setStartPrice(name) : this.setMinutePrice(name));
            }

            this.logger.log("Timeouts restarted");
        } else
            this.logger.log("No timeout to restart");
    }

    async getStatistics() {
        const symbols = await this.symbolRepository.find({ where: { isFinished: true }, relations: { history: true } });
        const response = [];

        for (let i = 0; i < symbols.length; i++) {
            let symbol = symbols[i];

            response.push({
                symbol: symbol.name,
                priceOnStart: symbol.priceOnStart,
                priceOnMinute: symbol.priceOnMinute
            });

            for (let j = 0; (j < symbol.history.length && j < 24); j++)
                response[i][j + 1] = symbol.history[j].price;
        }

        return response;
    }

    private async createOrder(symbol: string, side: Side) {
        try {
            const { MEXC_API_KEY, MEXC_HOST } = process.env;

            const myHeaders = new Headers();
            myHeaders.append("x-mexc-apikey", MEXC_API_KEY);

            const queryParams = [
                {
                    key: 'symbol',
                    value: symbol
                },
                {
                    key: 'side',
                    value: side
                },
                {
                    key: 'type',
                    value: 'LIMIT'
                },
                {
                    key: 'quantity',
                    value: '100'
                },
                {
                    key: 'price',
                    value: '0.1'
                }
            ]

            const requestOptions = {
                method: "POST",
                headers: myHeaders
            };

            const queryString = this.generateQueryString(queryParams);

            const response = await fetch(`${MEXC_HOST}/order?${queryString}`, requestOptions)
            const result = await response.json();

            return { success: true };
        } catch (error) {
            console.error(error)

            return { success: false };
        }
    }

    private addTimeout(name: string, milliseconds: number, callback: (name: string) => Promise<{ success: boolean }>) {
        if (this.schedulerRegistry.doesExist('timeout', name))
            this.schedulerRegistry.deleteTimeout(name);

        const timeout = setTimeout(() => callback(name), milliseconds);
        this.schedulerRegistry.addTimeout(name, timeout);
    }

    private generateQueryString(parameters: { key: string, value: string, disabled?: boolean }[]): string {
        const ts = Date.now();

        let paramsObject = {};
        let queryString;

        const { MEXC_API_SECRET: api_secret } = process.env;

        parameters.map((param) => {
            if (param.key != 'signature' &&
                param.key != 'timestamp' &&
                !is_empty(param.value) &&
                !is_disabled(param.disabled)) {
                paramsObject[param.key] = param.value;
            }
        })

        Object.assign(paramsObject, { 'timestamp': ts });

        if (api_secret) {
            queryString = Object.keys(paramsObject).map((key) => {
                return `${key}=${paramsObject[key]}`;
            }).join('&');

            const signature = createHmac('sha256', api_secret)
                .update(queryString)
                .digest('hex');

            queryString += "&signature=" + signature;
        }

        function is_disabled(str) {
            return str == true;
        }
        
        function is_empty(str) {
            if (typeof str == 'undefined' ||
                !str ||
                str.length === 0 ||
                str === "" ||
                !/[^\s]/.test(str) ||
                /^\s*$/.test(str) ||
                str.replace(/\s/g, "") === "") {
                return true;
            }
            else {
                return false;
            }
        }

        return queryString;
    }

    private delay(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    @Cron('0 * * * *')
    async addPrices() {
        const { MEXC_HOST } = process.env;

        const symbols = await this.symbolRepository.find({ where: { isFinished: false, isListed: true } });

        for (let symbol of symbols) {
            const response = await fetch(`${MEXC_HOST}/ticker/price?symbol=${symbol.name}`);
            const data = await response.json();

            await this.historyRepository.save({
                symbol,
                price: data.price
            });

            const { count } = await this.historyRepository
                .createQueryBuilder('history')
                .select('COUNT("symbolId") as "count"')
                .where('"symbolId" = ' + symbol.id)
                .groupBy('"symbolId"')
                .getRawOne();

            if (count >= 24) {
                symbol.isFinished = true;
                await this.symbolRepository.save(symbol);
            }
        }
    }
}
